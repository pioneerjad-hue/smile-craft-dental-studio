import { useEffect, useState } from 'react';
import type { Arch } from '../../core/fdi';
import { exportStages, openReport, planSummary, stageStl } from '../../engine/exporter';
import { download, safeName } from '../../engine/project';
import { useStudio } from '../../engine/store';
import { Check, IssuesList, NumberInput } from '../common';

export function ExportPanel() {
  const staging = useStudio((s) => s.staging);
  const arches = useStudio((s) => s.arches);
  const issues = useStudio((s) => s.issues);
  const caseInfo = useStudio((s) => s.caseInfo);
  const stage = useStudio((s) => s.stage);
  const busy = useStudio((s) => s.busy);
  const total = staging?.totalStages ?? 0;
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(total);
  const [sel, setSel] = useState<Record<Arch, boolean>>({ upper: true, lower: true });
  const [attachments, setAttachments] = useState(true);
  const [template, setTemplate] = useState(true);
  useEffect(() => setTo(total), [total]);
  const errors = issues.filter((i) => i.severity === 'error');
  const archList = (['upper', 'lower'] as Arch[]).filter((a) => sel[a] && arches[a]);
  const count = archList.length * (Math.max(0, to - from) + 1);

  return (
    <>
      <div className="section">
        <h3>Print models</h3>
        <div className="hint">
          One binary STL per arch per stage, in scan coordinates (mm), with attachments fused onto the crowns. The gum
          follows the teeth so every model stays closed like the original scan. Includes a manifest (CSV) and the plan
          (JSON) for your lab software.
        </div>
        <div className="field">
          <label>From stage</label>
          <NumberInput value={from} step={1} min={0} max={total} digits={0} onChange={(v) => setFrom(Math.round(v))} />
        </div>
        <div className="field">
          <label>To stage</label>
          <NumberInput value={to} step={1} min={0} max={total} digits={0} onChange={(v) => setTo(Math.round(v))} />
        </div>
        <Check checked={sel.upper} onChange={(v) => setSel({ ...sel, upper: v })}>
          Upper {arches.upper ? `(${staging?.archStages.upper ?? 0} aligners)` : '(no scan)'}
        </Check>
        <Check checked={sel.lower} onChange={(v) => setSel({ ...sel, lower: v })}>
          Lower {arches.lower ? `(${staging?.archStages.lower ?? 0} aligners)` : '(no scan)'}
        </Check>
        <Check checked={attachments} onChange={setAttachments}>
          Include attachments
        </Check>
        <Check checked={template} onChange={setTemplate}>
          Attachment template model (stage 0 + attachments)
        </Check>
        {errors.length > 0 && (
          <div className="small" style={{ color: 'var(--bad)' }}>
            {errors.length} protocol error(s) — review before printing.
          </div>
        )}
        <button className="primary" disabled={!count || !!busy} onClick={() => exportStages({ from, to, arches: archList, attachments, template })}>
          Export {count} models (.zip)
        </button>
        <div className="row wrap">
          {archList.map((a) => (
            <button
              key={a}
              onClick={() => download(stageStl(a, stage, attachments), `${safeName(caseInfo.caseId || caseInfo.patientName)}_${a === 'upper' ? 'U' : 'L'}_S${String(stage).padStart(2, '0')}.stl`)}
            >
              Current stage {a} STL
            </button>
          ))}
        </div>
      </div>
      <div className="section">
        <h3>Documents</h3>
        <button onClick={openReport}>Treatment plan report (print / PDF)</button>
        <button onClick={() => download(JSON.stringify(planSummary(), null, 2), `${safeName(caseInfo.caseId || 'case')}_plan.json`, 'application/json')}>Plan summary (JSON)</button>
      </div>
      <div className="section">
        <h3>Protocol check</h3>
        <IssuesList issues={issues} limit={8} />
      </div>
    </>
  );
}
