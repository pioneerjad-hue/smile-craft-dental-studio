import { useEffect, useState } from 'react';
import type { Arch } from '../../core/fdi';
import { toast, useStudio } from '../../engine/store';
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
      <RepairSection />
      <div className="section">
        <h3>Orientation</h3>
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
      {oriented && <TrimSection />}
      <div className="grow" />
      <button className="primary" onClick={() => goToStep('segment')}>
        Continue to segmentation →
      </button>
    </>
  );
}

function confirmReset(): boolean {
  return useStudio.getState().teeth.length === 0 || confirm('This changes the scan mesh and clears the segmentation of the changed arch. Continue?');
}

function RepairSection() {
  return (
    <div className="section">
      <h3>Model repair</h3>
      <div className="hint small">Removes floating scan debris and fills small holes (gaps under 20 mm around). The outer scan border stays open; the model builder closes it.</div>
      <button
        onClick={() => {
          if (!confirmReset()) return;
          const r = studio.repairScans();
          toast(r.removed || r.filled ? `Removed ${r.removed} debris triangle(s), filled ${r.filled} hole(s).` : 'Scans are clean — nothing to repair.', 'success');
        }}
      >
        ✦ Auto-repair scans
      </button>
    </div>
  );
}

function TrimSection() {
  const arches = useStudio((s) => s.arches);
  const [keep, setKeep] = useState<Record<Arch, number>>({ upper: 22, lower: 20 });
  const [active, setActive] = useState<Arch | null>(null);
  useEffect(() => {
    if (active) studio.previewTrim(active, keep[active]);
    return () => {
      studio.previewTrim('upper', null);
      studio.previewTrim('lower', null);
    };
  }, [active, keep]);
  return (
    <div className="section">
      <h3>Trim (cut and close)</h3>
      <div className="hint small">Cuts the scan with a plane parallel to the occlusal plane, keeping this height from the crown tops. The red plane previews the cut.</div>
      {(['upper', 'lower'] as Arch[])
        .filter((a) => arches[a])
        .map((a) => (
          <div key={a} className="card">
            <div className="row between">
              <span style={{ textTransform: 'capitalize' }}>{a}</span>
              <b className="mono">{keep[a].toFixed(1)} mm</b>
            </div>
            <input
              type="range"
              min={8}
              max={40}
              step={0.5}
              value={keep[a]}
              onFocus={() => setActive(a)}
              onPointerDown={() => setActive(a)}
              onChange={(e) => setKeep({ ...keep, [a]: +e.target.value })}
            />
            <button
              onClick={() => {
                if (!confirmReset()) return;
                studio.trimArch(a, keep[a]);
                setActive(null);
                toast(`${a} model trimmed.`, 'success');
              }}
            >
              Apply trim
            </button>
          </div>
        ))}
    </div>
  );
}
