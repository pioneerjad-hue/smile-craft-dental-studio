import { useStudio } from '../../engine/store';
import { studio } from '../../engine/studio';
import { goToStep } from '../App';

const NUDGES: { axis: 'x' | 'y' | 'z'; label: string; hint: string }[] = [
  { axis: 'x', label: 'Tilt (pitch)', hint: 'incisors up / down — check in the Right view' },
  { axis: 'y', label: 'Roll', hint: 'left / right side up — check in the Front view' },
  { axis: 'z', label: 'Turn (yaw)', hint: 'midline left / right — check in the Upper/Lower view' },
];

export function OrientPanel() {
  const oriented = useStudio((s) => s.oriented);
  const tool = useStudio((s) => s.tool);
  const points = useStudio((s) => s.orientPoints);
  const PROMPTS = ['the incisal point between the two central incisors', "the mesio-buccal cusp of the patient's RIGHT first molar", "the mesio-buccal cusp of the patient's LEFT first molar"];
  return (
    <>
      <div className="section">
        <h3>Model orientation</h3>
        <div className="hint">
          Both arches are oriented together, so the bite is kept. Target: occlusal plane on the grid, midline on the red
          line, incisors toward the front. Segmentation, tooth axes and all movements use this orientation.
        </div>
        <button className="primary" onClick={() => studio.autoOrient()}>
          ✦ Auto-orient
        </button>
        {oriented && <span className="pill good">oriented</span>}
      </div>

      <div className="section">
        <h3>Or: 3 landmarks</h3>
        {tool === 'orientPoints' ? (
          <div className="card">
            <b>Click point {points + 1} of 3</b>
            <div className="small" style={{ marginTop: 4 }}>{PROMPTS[points]}</div>
            <button style={{ marginTop: 8 }} onClick={() => studio.startLandmarks()}>
              Restart
            </button>
          </div>
        ) : (
          <button onClick={() => studio.startLandmarks()}>Set occlusal plane from 3 points…</button>
        )}
        <div className="hint small">Click on the upper or lower arch. The plane through the 3 points becomes the occlusal plane.</div>
      </div>

      <div className="section">
        <h3>Fine adjustment</h3>
        <div className="nudge">
          {NUDGES.map((n) => (
            <div key={n.axis} style={{ display: 'contents' }}>
              <span title={n.hint}>{n.label}</span>
              <button onClick={() => studio.nudgeOrientation(n.axis, -5)}>−5°</button>
              <button onClick={() => studio.nudgeOrientation(n.axis, -1)}>−1°</button>
              <button onClick={() => studio.nudgeOrientation(n.axis, 1)}>+1°</button>
              <button onClick={() => studio.nudgeOrientation(n.axis, 5)}>+5°</button>
            </div>
          ))}
        </div>
        <div className="row wrap">
          <button onClick={() => studio.nudgeOrientation('y', 180)}>Flip upside down</button>
          <button onClick={() => studio.nudgeOrientation('z', 180)}>Turn 180°</button>
          <button className="danger" onClick={() => studio.resetOrientation()}>
            Back to scanner orientation
          </button>
        </div>
        <div className="hint small">
          Views: <span className="kbd">1</span> front · <span className="kbd">2</span> right · <span className="kbd">3</span> left ·{' '}
          <span className="kbd">4</span> upper · <span className="kbd">5</span> lower.
        </div>
      </div>
      <div className="grow" />
      <button className="primary" onClick={() => goToStep('segment')}>
        Continue to segmentation →
      </button>
    </>
  );
}
