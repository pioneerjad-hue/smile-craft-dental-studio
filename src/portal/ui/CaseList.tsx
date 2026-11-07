import { useMemo, useState } from 'react';
import { usePortal } from '../store';
import { PRODUCTS, STATUS_LABEL, patientName } from '../model';
import type { CaseStatus, PortalCase } from '../model';
import { actionReason, isActive, needsAction, unreadCount } from '../workflow';
import { Empty, StatusBadge, fmtDate, go, hashQuery, relTime } from './common';

type Filter = 'all' | 'action' | 'active' | 'planning' | 'production' | CaseStatus;

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['action', 'Needs action'],
  ['active', 'Active'],
  ['draft', 'Drafts'],
  ['planning', 'In planning'],
  ['plan_ready', 'Plan review'],
  ['production', 'Production'],
  ['in_treatment', 'In treatment'],
  ['retention', 'Retention'],
  ['completed', 'Completed'],
];

const GROUPS: Partial<Record<Filter, CaseStatus[]>> = {
  planning: ['submitted', 'planning', 'modification_requested', 'refinement', 'records_issue'],
  production: ['approved', 'manufacturing', 'shipped'],
  retention: ['retention'],
  completed: ['completed', 'cancelled'],
};

export function CaseList() {
  const role = usePortal((s) => s.role);
  const cases = usePortal((s) => s.db.cases);
  const updateCase = usePortal((s) => s.updateCase);
  const [filter, setFilter] = useState<Filter>(() => (hashQuery().get('f') as Filter) || 'all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'updated' | 'name' | 'created'>('updated');

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (c: PortalCase) => {
      if (filter === 'action') return needsAction(c, role);
      if (filter === 'active') return isActive(c);
      if (filter === 'all') return true;
      return (GROUPS[filter] ?? [filter]).includes(c.status);
    };
    return cases
      .filter(match)
      .filter((c) => !term || `${patientName(c.patient)} ${c.number} ${c.patient.chartNumber}`.toLowerCase().includes(term))
      .sort((a, b) =>
        sort === 'name' ? patientName(a.patient).localeCompare(patientName(b.patient)) : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
      )
      .sort((a, b) => Number(!!b.starred) - Number(!!a.starred));
  }, [cases, filter, q, sort, role]);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Patients & cases</h1>
          <p className="muted">{cases.length} cases</p>
        </div>
        {role === 'doctor' && (
          <button className="primary" onClick={() => go('cases/new')}>
            + New case
          </button>
        )}
      </div>

      <div className="toolbar">
        <input type="search" placeholder="Search patient, case number or chart number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cases" className="search" />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="updated">Last updated</option>
          <option value="created">Newest</option>
          <option value="name">Patient name</option>
        </select>
      </div>
      <div className="chips" role="tablist" aria-label="Filter cases">
        {FILTERS.map(([f, l]) => (
          <button key={f} role="tab" aria-selected={filter === f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
            {l}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <Empty title="No cases match">Try another filter or search term.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="cases">
            <thead>
              <tr>
                <th aria-label="Starred" />
                <th>Patient</th>
                <th>Status</th>
                <th className="hide-sm">Product</th>
                <th className="hide-sm">Next step</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const unread = unreadCount(c, role);
                return (
                  <tr key={c.id} onClick={() => go(`cases/${c.id}`)} className={needsAction(c, role) ? 'hot' : ''}>
                    <td>
                      <button
                        className={`star${c.starred ? ' on' : ''}`}
                        aria-label={c.starred ? 'Unstar case' : 'Star case'}
                        onClick={(e) => {
                          e.stopPropagation();
                          updateCase(c.id, { starred: !c.starred });
                        }}
                      >
                        {c.starred ? '★' : '☆'}
                      </button>
                    </td>
                    <td>
                      <a href={`#/cases/${c.id}`} onClick={(e) => e.stopPropagation()}>
                        <strong>{patientName(c.patient)}</strong>
                      </a>
                      <div className="small muted">
                        {c.number} · since {fmtDate(c.createdAt)}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                      {unread > 0 && <span className="pill msg" title={`${unread} unread`}>✉ {unread}</span>}
                    </td>
                    <td className="hide-sm">{PRODUCTS[c.rx.product].name.replace('Smile Craft ', '')}</td>
                    <td className="hide-sm small">{actionReason(c, role) || <span className="muted">{waitingText(c.status, role)}</span>}</td>
                    <td className="small muted">{relTime(c.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function waitingText(s: CaseStatus, role: 'doctor' | 'lab') {
  if (s === 'completed' || s === 'cancelled' || s === 'in_treatment' || s === 'retention') return STATUS_LABEL[s];
  return role === 'doctor' ? 'With Smile Craft' : 'With the doctor';
}
