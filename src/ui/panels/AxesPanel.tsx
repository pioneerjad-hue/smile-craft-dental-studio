import { shortLabel, toothName } from '../../core/fdi';
import type { AxisCorrection } from '../../core/types';
import { setState, useStudio } from '../../engine/store';
import { studio } from '../../engine/studio';
import { goToStep } from '../App';
import { Odontogram } from '../common';

const ROWS: { key: keyof AxisCorrection; label: string; hint: string }[] = [
  { key: 'tip', label: 'Tip (mesio-distal)', hint: 'tilt the long axis mesially / distally — check from buccal' },
  { key: 'torque', label: 'Torque (bucco-lingual)', hint: 'tilt the long axis buccally / lingually — check from mesial' },
  { key: 'rotation', label: 'Rotation', hint: 'turn the mesial axis around the long axis — check from occlusal' },
];

export function AxesPanel() {
  const selected = useStudio((s) => s.selectedTooth);
  const plan = useStudio((s) => s.plan);
  const frames = useStudio((s) => s.frames);
  const layers = useStudio((s) => s.layers);
  const tp = selected !== null ? plan.teeth[selected] : undefined;
  const f = selected !== null ? frames[selected] : undefined;
  const corr: AxisCorrection = tp?.axisCorrection ?? { tip: 0, torque: 0, rotation: 0 };
  const seeThrough = layers.upperGum.opacity < 1 || layers.lowerGum.opacity < 1;
  const toggleGum = () =>
    setState((s) => ({
      layers: {
        ...s.layers,
        upperGum: { ...s.layers.upperGum, opacity: seeThrough ? 1 : 0.3 },
        lowerGum: { ...s.layers.lowerGum, opacity: seeThrough ? 1 : 0.3 },
        upperRoots: { ...s.layers.upperRoots, visible: !seeThrough },
        lowerRoots: { ...s.layers.lowerRoots, visible: !seeThrough },
      },
    }));
  return (
    <>
      <div className="section">
        <h3>Tooth axes & roots</h3>
        <div className="hint">
          Each tooth gets a long axis from its crown shape (blue), a mesial axis along the arch (red) and a buccal axis
          (green). Every movement in the plan uses these axes, so check them before planning. Roots are templates built
          on the long axis using your protocol's root lengths. Select a tooth and drag the rings to rotate its axes
          (orange tip, violet torque, cyan rotation), or use the buttons.
        </div>
        <button onClick={toggleGum}>{seeThrough ? 'Opaque gum, hide roots' : 'See-through gum + show roots'}</button>
      </div>
      <div className="section">
        <h3>Select tooth</h3>
        <Odontogram current={selected} onPick={(id) => setState({ selectedTooth: id })} mode="plan" />
      </div>
      {tp && f && (
        <div className="section">
          <div>
            <b>
              {tp.id} · {shortLabel(tp.id)}
            </b>
            <div className="small muted">{toothName(tp.id)}</div>
          </div>
          {ROWS.map((r) => (
            <div key={r.key} className="card" title={r.hint}>
              <div className="row between">
                <span>{r.label}</span>
                <b className="mono">{corr[r.key].toFixed(1)}°</b>
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                {[-5, -1, 1, 5].map((d) => (
                  <button key={d} onClick={() => studio.setAxisCorrection(tp.id, { ...corr, [r.key]: corr[r.key] + d })}>
                    {d > 0 ? `+${d}` : d}°
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="field">
            <label>Root length</label>
            <div className="row">
              {[-1, 1].map((d) => (
                <button key={d} onClick={() => studio.setRootLength(tp.id, Math.max(5, (f.rootLengthMm ?? 13) + d))}>
                  {d > 0 ? '+1' : '−1'}
                </button>
              ))}
              <span className="mono">{(f.rootLengthMm ?? 0).toFixed(1)} mm</span>
            </div>
          </div>
          <div className="row wrap">
            <button onClick={() => studio.setAxisCorrection(tp.id, { tip: 0, torque: 0, rotation: 0 })}>Reset axis</button>
            {tp.rootLengthMm !== undefined && <button onClick={() => studio.setRootLength(tp.id, undefined)}>Default root</button>}
          </div>
        </div>
      )}
      <div className="grow" />
      <button className="primary" onClick={() => goToStep('plan')}>
        Axes OK — continue to planning →
      </button>
    </>
  );
}
