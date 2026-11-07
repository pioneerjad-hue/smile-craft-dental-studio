import { usePortal } from '../store';
import { STATUS_LABEL, patientName } from '../model';
import type { PortalCase } from '../model';
import { actionReason, isActive, needsAction } from '../workflow';
import { Empty, StatusBadge, go, relTime } from './common';

export function approvedPlan(c: PortalCase) {
  return [...c.plans].reverse().find((p) => p.status === 'approved');
}

export function Dashboard() {
  const role = usePortal((s) => s.role);
  const cases = usePortal((s) => s.db.cases);
  const doctor = usePortal((s) => s.db.doctor);

  const todo = cases.filter((c) => needsAction(c, role)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const reviewing = cases.filter((c) => c.status === 'plan_ready').length;
  const production = cases.filter((c) => ['approved', 'manufacturing', 'shipped'].includes(c.status)).length;
  const planning = cases.filter((c) => ['submitted', 'planning', 'modification_requested', 'refinement'].includes(c.status)).length;
  const active = cases.filter((c) => c.status === 'in_treatment').length;
  const transit = cases.flatMap((c) => c.shipments.filter((s) => !s.delivered).map((s) => ({ c, s })));
  const inTreatment = cases.filter((c) => c.status === 'in_treatment');
  const activity = cases
    .flatMap((c) => c.events.map((e) => ({ c, e })))
    .filter(({ e }) => e.by !== role)
    .sort((a, b) => b.e.at.localeCompare(a.e.at))
    .slice(0, 8);

  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>
            {hello}
            {role === 'doctor' ? `, ${doctor.name}` : ''}
          </h1>
          <p className="muted">{todo.length ? `${todo.length} case${todo.length > 1 ? 's' : ''} need${todo.length === 1 ? 's' : ''} your attention.` : 'You are all caught up.'}</p>
        </div>
        {role === 'doctor' && (
          <button className="primary" onClick={() => go('cases/new')}>
            + New case
          </button>
        )}
      </div>

      <div className="kpis">
        <button className="kpi accent" onClick={() => go('cases?f=action')}>
          <span className="kpi-n">{todo.length}</span>
          <span className="kpi-l">Need action</span>
        </button>
        {role === 'doctor' ? (
          <button className="kpi" onClick={() => go('cases?f=plan_ready')}>
            <span className="kpi-n">{reviewing}</span>
            <span className="kpi-l">Plans to review</span>
          </button>
        ) : (
          <button className="kpi" onClick={() => go('cases?f=planning')}>
            <span className="kpi-n">{planning}</span>
            <span className="kpi-l">In planning</span>
          </button>
        )}
        <button className="kpi" onClick={() => go('cases?f=production')}>
          <span className="kpi-n">{production}</span>
          <span className="kpi-l">In production / shipping</span>
        </button>
        <button className="kpi" onClick={() => go('cases?f=in_treatment')}>
          <span className="kpi-n">{active}</span>
          <span className="kpi-l">Patients in treatment</span>
        </button>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>Needs your attention</h2>
          {todo.length === 0 ? (
            <Empty title="Nothing waiting on you">New plans, record requests and messages show up here.</Empty>
          ) : (
            <ul className="todo">
              {todo.map((c) => (
                <li key={c.id}>
                  <a href={`#/cases/${c.id}${c.status === 'plan_ready' && role === 'doctor' ? '/plan' : ''}`}>
                    <div className="grow">
                      <strong>{patientName(c.patient)}</strong> <span className="muted small">{c.number}</span>
                      <div className="small">{actionReason(c, role)}</div>
                    </div>
                    <StatusBadge status={c.status} />
                    <span className="chev" aria-hidden="true">
                      ›
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="stack">
          <section className="panel">
            <h2>Patients in treatment</h2>
            {inTreatment.length === 0 ? (
              <Empty title="No active patients yet" />
            ) : (
              <ul className="progress-list">
                {inTreatment.map((c) => {
                  const p = approvedPlan(c);
                  const total = p ? Math.max(p.summary.stages.upper, p.summary.stages.lower) : 0;
                  const cur = c.currentAligner ?? 1;
                  return (
                    <li key={c.id}>
                      <a href={`#/cases/${c.id}`}>
                        <div className="row between">
                          <strong>{patientName(c.patient)}</strong>
                          <span className="small muted">
                            Aligner {cur} of {total || '?'}
                            {c.refinements ? ` · refinement ${c.refinements}` : ''}
                          </span>
                        </div>
                        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={cur}>
                          <span style={{ width: `${total ? Math.min(100, (cur / total) * 100) : 0}%` }} />
                        </div>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>Shipments on the way</h2>
            {transit.length === 0 ? (
              <Empty title="No shipments in transit" />
            ) : (
              <ul className="simple">
                {transit.map(({ c, s }) => (
                  <li key={s.id}>
                    <a href={`#/cases/${c.id}/shipping`}>
                      <strong>{patientName(c.patient)}</strong>
                      <span className="small muted">
                        {s.carrier} · {s.tracking} · sent {relTime(s.createdAt)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="panel">
        <h2>Recent activity</h2>
        {activity.length === 0 ? (
          <Empty title="No activity yet" />
        ) : (
          <ul className="feed">
            {activity.map(({ c, e }, i) => (
              <li key={i}>
                <span className="feed-dot" aria-hidden="true" />
                <div className="grow">
                  <a href={`#/cases/${c.id}`}>
                    <strong>{patientName(c.patient)}</strong>
                  </a>{' '}
                  – {e.text}
                </div>
                <span className="small muted">{relTime(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">
          {cases.filter(isActive).length} active cases · statuses: {Object.entries(countBy(cases)).map(([k, v]) => `${STATUS_LABEL[k as PortalCase['status']]} ${v}`).join(' · ')}
        </p>
      </section>
    </div>
  );
}

function countBy(cases: PortalCase[]) {
  const o: Record<string, number> = {};
  for (const c of cases) o[c.status] = (o[c.status] ?? 0) + 1;
  return o;
}
