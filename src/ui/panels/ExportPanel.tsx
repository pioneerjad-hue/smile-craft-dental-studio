import { useEffect, useState } from 'react';
import type { Arch } from '../../core/fdi';
import { exportDoctorViewer, exportStages, openReport, planSummary, stageStl } from '../../engine/exporter';
import { download, safeName } from '../../engine/project';
import { saveLab, setState, useStudio } from '../../engine/store';
import type { View } from '../../engine/store';
import { VIEW_LABEL, exportVideo, videoSupported } from '../../engine/video';
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
      <ModelBuilderSection />
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
      <DoctorViewerSection />
      <VideoSection />
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

function ModelBuilderSection() {
  const mb = useStudio((s) => s.modelBuilder);
  const report = useStudio((s) => s.baseReport);
  const caseLabel = useStudio((s) => s.caseInfo.caseId || s.caseInfo.patientName || 'CASE');
  const set = (patch: Partial<typeof mb>) => setState({ modelBuilder: { ...mb, ...patch } });
  return (
    <div className="section">
      <h3>Model builder</h3>
      <Check checked={mb.enabled} onChange={(v) => set({ enabled: v })}>
        Add a flat printable base (closed solid)
      </Check>
      {mb.enabled && (
        <>
          <div className="field">
            <label>Base below scan</label>
            <NumberInput value={mb.thicknessMm} step={0.5} min={0.5} max={30} digits={1} onChange={(v) => set({ thicknessMm: v })} />
          </div>
          <Check checked={mb.label} onChange={(v) => set({ label: v })}>
            Engrave case & stage on the base (e.g. "{caseLabel} U07")
          </Check>
          {(['upper', 'lower'] as Arch[]).map((a) => {
            const r = report[a];
            if (!r) return null;
            return (
              <div className="row between small" key={a}>
                <span style={{ textTransform: 'capitalize' }}>{a}</span>
                {r.openEdges === 0 ? <span className="pill good">watertight ✓</span> : <span className="pill warn">{r.openEdges} open edges</span>}
                {mb.label && (r.labelPlaced ? <span className="pill good">label ✓</span> : <span className="pill warn">label does not fit</span>)}
              </div>
            );
          })}
          <div className="hint small">
            The scan border is extruded to a flat plane parallel to the occlusal plane and capped, so every stage exports as one
            closed solid ready for the slicer. Toggle and colour the base in ☰ Layers.
          </div>
        </>
      )}
      <h3 style={{ marginTop: 10 }}>Aligner trim lines</h3>
      <Check checked={mb.trimLines} onChange={(v) => set({ trimLines: v })}>
        Show trim line and export it per stage (.pts)
      </Check>
      {mb.trimLines && (
        <div className="field">
          <label>Offset from teeth</label>
          <NumberInput value={mb.trimOffsetMm} step={0.25} min={0.25} max={5} onChange={(v) => set({ trimOffsetMm: v })} />
        </div>
      )}
      <div className="hint small">Scalloped line on the gingiva at this distance from the tooth margins, following the gum at every stage. Exported as x y z points (mm) for CNC/laser trimmers, in the same coordinates as the STL models.</div>
    </div>
  );
}

const RESOLUTIONS: [string, number, number][] = [
  ['1920 × 1080 (Full HD)', 1920, 1080],
  ['1280 × 720 (HD)', 1280, 720],
  ['1080 × 1080 (square, social)', 1080, 1080],
  ['1080 × 1920 (vertical, phone)', 1080, 1920],
];

function VideoSection() {
  const staging = useStudio((s) => s.staging);
  const busy = useStudio((s) => s.busy);
  const [res, setRes] = useState(0);
  const [spsMs, setSps] = useState(0.4);
  const [hold, setHold] = useState(1);
  const [overlay, setOverlay] = useState(true);
  const [initial, setInitial] = useState(false);
  const [views, setViews] = useState<View[]>(['front', 'right', 'left', 'upperOcclusal', 'lowerOcclusal']);
  const total = staging?.totalStages ?? 0;
  const seconds = views.length * (2 * hold + Math.max(1, total) * spsMs);
  const toggle = (v: View) => setViews(views.includes(v) ? views.filter((x) => x !== v) : (Object.keys(VIEW_LABEL) as View[]).filter((x) => x === v || views.includes(x)));
  return (
    <div className="section">
      <h3>Simulation video (MP4)</h3>
      {!videoSupported() && <div className="small" style={{ color: 'var(--warn)' }}>Video export needs a current Chrome, Edge or Safari.</div>}
      <div className="field">
        <label>Resolution</label>
        <select value={res} onChange={(e) => setRes(+e.target.value)}>
          {RESOLUTIONS.map(([l], i) => (
            <option key={l} value={i}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Sec / aligner</label>
        <NumberInput value={spsMs} step={0.1} min={0.05} max={5} onChange={setSps} />
      </div>
      <div className="field">
        <label>Hold start/end</label>
        <NumberInput value={hold} step={0.5} min={0} max={10} digits={1} onChange={setHold} />
      </div>
      <div className="row wrap small">
        {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
          <label key={v} className="checkbox">
            <input type="checkbox" checked={views.includes(v)} onChange={() => toggle(v)} /> {VIEW_LABEL[v]}
          </label>
        ))}
      </div>
      <Check checked={overlay} onChange={setOverlay}>
        Case name, view and aligner counter
      </Check>
      <Check checked={initial} onChange={setInitial}>
        Show initial position overlay
      </Check>
      <button
        className="primary"
        disabled={!views.length || !!busy || !videoSupported()}
        onClick={() => exportVideo({ width: RESOLUTIONS[res][1], height: RESOLUTIONS[res][2], fps: 30, secondsPerStage: spsMs, holdSeconds: hold, views, overlay, showInitial: initial })}
      >
        Export video · ≈ {Math.round(seconds)} s
      </button>
      <div className="hint small">H.264 MP4 — plays in QuickTime, PowerPoint, WhatsApp and on phones. Layer colours and opacity are used as shown.</div>
    </div>
  );
}

function DoctorViewerSection() {
  const lab = useStudio((s) => s.lab);
  const busy = useStudio((s) => s.busy);
  const set = (patch: Partial<typeof lab>) => {
    const next = { ...lab, ...patch };
    setState({ lab: next });
    saveLab(next);
  };
  return (
    <div className="section">
      <h3>Doctor viewer</h3>
      <div className="hint small">
        One HTML file for the treating doctor: all aligner steps in 3D (play, views, initial overlay), IPR, attachments,
        movements and occlusion, with <b>Approve</b> / <b>Request changes</b> buttons that send the reply to your lab.
        Opens in any browser, also on phones, without installing anything.
      </div>
      <div className="field">
        <label>Lab name</label>
        <input type="text" value={lab.name} onChange={(e) => set({ name: e.target.value })} placeholder="Smile Craft Lab" />
      </div>
      <div className="field">
        <label>Reply email</label>
        <input type="text" value={lab.email} onChange={(e) => set({ email: e.target.value })} placeholder="lab@example.com" />
      </div>
      <div className="field">
        <label>WhatsApp</label>
        <input type="text" value={lab.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} placeholder="+961 …" />
      </div>
      <button className="primary" disabled={!!busy} onClick={() => void exportDoctorViewer()}>
        Export doctor viewer (.html)
      </button>
    </div>
  );
}
