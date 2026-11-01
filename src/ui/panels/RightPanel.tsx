import type { Arch } from '../../core/fdi';
import { bolton, spaceAnalysis, toothWidth } from '../../core/analysis';
import { sortTeeth } from '../../core/fdi';
import { setState, useStudio } from '../../engine/store';
import { studio } from '../../engine/studio';
import { useSettings } from '../common';

export function RightPanel() {
  const step = useStudio((s) => s.step);
  const plan = useStudio((s) => s.plan);
  const frames = useStudio((s) => s.frames);
  const measurements = useStudio((s) => s.measurements);
  const [settings, set] = useSettings();
  const hasFrames = Object.keys(frames).length > 0;
  const ba = bolton(plan, frames, 'anterior');
  const bo = bolton(plan, frames, 'overall');
  const status = (r: ReturnType<typeof bolton>) =>
    r.missing.length ? <span className="pill">incomplete</span> : Math.abs(r.ratio - r.ideal) <= r.sd ? <span className="pill good">normal</span> : <span className="pill warn">{r.excessMm > 0 ? 'mand.' : 'max.'} excess {Math.abs(r.excessMm).toFixed(1)} mm</span>;

  return (
    <>
      {hasFrames && step !== 'segment' && (
        <div className="section">
          <h3>Analysis</h3>
          <div className="card">
            <div className="row between">
              <span>Bolton anterior</span>
              <b>{ba.ratio ? `${ba.ratio.toFixed(1)}%` : '–'}</b>
            </div>
            <div className="row between small muted">
              <span>ideal {ba.ideal} ± {ba.sd}</span>
              {status(ba)}
            </div>
          </div>
          <div className="card">
            <div className="row between">
              <span>Bolton overall</span>
              <b>{bo.ratio ? `${bo.ratio.toFixed(1)}%` : '–'}</b>
            </div>
            <div className="row between small muted">
              <span>ideal {bo.ideal} ± {bo.sd}</span>
              {status(bo)}
            </div>
          </div>
          {(['upper', 'lower'] as Arch[]).map((arch) => {
            const sp = spaceAnalysis(arch, plan, frames);
            if (!sp) return null;
            return (
              <div className="card" key={arch}>
                <div className="row between">
                  <span style={{ textTransform: 'capitalize' }}>{arch} space</span>
                  <b className={sp.discrepancyMm < 0 ? 'neg' : 'pos'}>
                    {sp.discrepancyMm < 0 ? 'Crowding' : 'Spacing'} {Math.abs(sp.discrepancyMm).toFixed(1)} mm
                  </b>
                </div>
                <div className="small muted">
                  available {sp.availableMm.toFixed(1)} · required {sp.requiredMm.toFixed(1)} mm ({sp.teeth[0]}…{sp.teeth[sp.teeth.length - 1]})
                </div>
              </div>
            );
          })}
          <OcclusionCard />
          <details>
            <summary>Tooth widths (mm)</summary>
            <table className="grid">
              <tbody>
                {sortTeeth(Object.keys(frames).map(Number)).map((id) => (
                  <tr key={id}>
                    <td>{id}</td>
                    <td>{(toothWidth(plan, frames, id) ?? 0).toFixed(2)}</td>
                    <td className="muted">{plan.teeth[id]?.manualWidthMm !== undefined ? 'measured' : 'auto'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <div className="hint small">Widths are measured on the mesh along each tooth's mesial axis. For rotated teeth, measure contact-to-contact in the tooth inspector for best accuracy.</div>
        </div>
      )}

      {step !== 'import' && step !== 'segment' && (
        <div className="section">
          <h3>Display</h3>
          <label>Gum flexibility {settings.gingivaFlexMm.toFixed(1)} mm</label>
          <input type="range" min={1} max={6} step={0.5} value={settings.gingivaFlexMm} onChange={(e) => set({ gingivaFlexMm: +e.target.value })} />
          <div className="hint small">How far the gingiva follows each moving tooth. The staged models stay closed (no holes) for printing.</div>
        </div>
      )}

      <div className="section">
        <div className="row between">
          <h3 style={{ margin: 0 }}>Measurements</h3>
          {measurements.length > 0 && (
            <button className="icon" onClick={() => setState({ measurements: [] })}>
              Clear
            </button>
          )}
        </div>
        {measurements.length === 0 ? (
          <div className="hint small">Press <span className="kbd">M</span> or use 📏 and click two points on the scan.</div>
        ) : (
          measurements.map((m, i) => (
            <div key={m.id} className="row between small">
              <span>#{i + 1}</span>
              <b>{m.label}</b>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function OcclusionCard() {
  // recompute when the plan / staging / segmentation changes
  useStudio((s) => s.staging);
  useStudio((s) => s.frames);
  const total = useStudio((s) => s.staging?.totalStages ?? 0);
  const a = studio.occlusionAt(0);
  const b = total ? studio.occlusionAt(total) : null;
  if (!a) return null;
  const row = (label: string, k: 'overjetMm' | 'overbiteMm' | 'midlineMm', hint: string) => (
    <div className="row between small" title={hint}>
      <span>{label}</span>
      <span className="mono">
        {a[k].toFixed(1)}
        {b && <> → <b>{b[k].toFixed(1)}</b></>} mm
      </span>
    </div>
  );
  return (
    <div className="card">
      <div className="row between">
        <span>Occlusion</span>
        <span className="small muted">initial{b ? ' → final' : ''}</span>
      </div>
      {row('Overjet', 'overjetMm', 'Upper incisal edge to lower incisor labial surface, parallel to the occlusal plane')}
      {row('Overbite', 'overbiteMm', 'Vertical incisor overlap: negative = open bite')}
      {row('Midline (upper − lower)', 'midlineMm', 'Positive = upper midline to the patient\'s right of the lower')}
    </div>
  );
}
