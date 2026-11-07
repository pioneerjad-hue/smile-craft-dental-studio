import { PRODUCTS, patientName } from '../model';
import type { PortalCase, Prescription } from '../model';
import { fmtDate } from './common';

const L: Record<string, string> = {
  maintain: 'Maintain',
  improve: 'Improve',
  class1: 'Class I canine',
  ideal: 'Ideal',
  correct_deep: 'Correct deep bite',
  correct_open: 'Correct open bite',
  improve_upper: 'Move upper to match',
  improve_lower: 'Move lower to match',
  improve_both: 'Move both',
  none: 'None',
  correct: 'Correct',
  yes: 'Yes',
  as_needed: 'As needed',
  no: 'No',
  both: 'Both arches',
  upper: 'Upper only',
  lower: 'Lower only',
};

export function rxRows(rx: Prescription): [string, string][] {
  return [
    ['Product', PRODUCTS[rx.product].name],
    ['Arches', L[rx.arches]],
    ['A-P right / left', `${L[rx.apRight]} / ${L[rx.apLeft]}`],
    ['Overjet', L[rx.overjet]],
    ['Overbite', L[rx.overbite]],
    ['Midline', L[rx.midline]],
    ['Posterior crossbite', rx.posteriorCrossbite === 'maintain' ? "Don't correct" : L[rx.posteriorCrossbite]],
    ['Expansion / proclination / IPR', `${L[rx.expand]} / ${L[rx.procline]} / ${L[rx.ipr]}`],
    ['Attachments', rx.attachmentsAllowed ? 'Allowed' : 'Not allowed'],
    ['Do not move', rx.doNotMove.join(', ') || '—'],
    ['No attachments on', rx.noAttachments.join(', ') || '—'],
    ['Extract / missing', rx.extract.join(', ') || '—'],
  ];
}

export function RxSummary({ c }: { c: Pick<PortalCase, 'patient' | 'rx'> }) {
  const p = c.patient;
  return (
    <div className="rx-summary">
      <dl className="kv">
        <div className="kv-row">
          <dt>Patient</dt>
          <dd>
            {patientName(p)} · {p.sex === 'F' ? 'Female' : p.sex === 'M' ? 'Male' : '—'} · born {p.dob ? fmtDate(p.dob) : '—'}
            {p.chartNumber && <span className="muted"> · chart {p.chartNumber}</span>}
          </dd>
        </div>
        {rxRows(c.rx).map(([k, v]) => (
          <div key={k} className="kv-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {c.rx.chiefComplaint && (
        <div>
          <h3>Chief complaint</h3>
          <p>{c.rx.chiefComplaint}</p>
        </div>
      )}
      {c.rx.notes && (
        <div>
          <h3>Additional instructions</h3>
          <p className="pre">{c.rx.notes}</p>
        </div>
      )}
    </div>
  );
}
