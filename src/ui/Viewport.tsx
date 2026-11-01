import { useEffect, useRef, useState } from 'react';
import { LayersPanel } from './LayersPanel';
import { setState, useStudio } from '../engine/store';
import type { View } from '../engine/store';
import { studio } from '../engine/studio';
import { useSettings } from './common';

const VIEWS: [View, string, string][] = [
  ['front', 'Front', '1'],
  ['right', 'Right', '2'],
  ['left', 'Left', '3'],
  ['upperOcclusal', 'Upper', '4'],
  ['lowerOcclusal', 'Lower', '5'],
];

export function Viewport() {
  const ref = useRef<HTMLDivElement>(null);
  const arches = useStudio((s) => s.arches);
  const step = useStudio((s) => s.step);
  const busy = useStudio((s) => s.busy);
  const tool = useStudio((s) => s.tool);
  const [settings, set] = useSettings();
  const [layersOpen, setLayersOpen] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    studio.mount(ref.current);
    return () => studio.unmount();
  }, []);

  const hasScan = !!(arches.upper || arches.lower);
  const planning = step === 'plan' || step === 'stage' || step === 'export' || step === 'protocol';

  return (
    <div className="viewport" ref={ref}>
      {!hasScan && (
        <div className="empty-state">
          <div>
            <h2 style={{ color: 'var(--text)', marginBottom: 4 }}>Smile Craft Dental Studio</h2>
            Import upper and lower intraoral scans (STL, PLY or OBJ) on the left, or load the demo case to explore the
            workflow: segment → plan → stage → export to print.
          </div>
        </div>
      )}
      {hasScan && (
        <div className="view-toolbar">
          {VIEWS.map(([v, label, key]) => (
            <button key={v} title={`${label} view (${key})`} onClick={() => studio.setView(v)}>
              {label}
            </button>
          ))}
          <div className="sep" />
          <button className={settings.showUpper ? 'active' : ''} onClick={() => set({ showUpper: !settings.showUpper })} title="Show upper arch (U)">
            U
          </button>
          <button className={settings.showLower ? 'active' : ''} onClick={() => set({ showLower: !settings.showLower })} title="Show lower arch (L)">
            L
          </button>
          {planning && (
            <>
              <button className={settings.showGhost ? 'active' : ''} onClick={() => set({ showGhost: !settings.showGhost })} title="Superimpose initial position (G)">
                Initial
              </button>
              <button className={settings.showAxes ? 'active' : ''} onClick={() => set({ showAxes: !settings.showAxes })} title="Tooth axes of the selected tooth">
                Axes
              </button>
              <button className={settings.showAttachments ? 'active' : ''} onClick={() => set({ showAttachments: !settings.showAttachments })} title="Attachments">
                Attach.
              </button>
            </>
          )}
          <div className="sep" />
          <button className={layersOpen ? 'active' : ''} onClick={() => setLayersOpen(!layersOpen)} title="Layers: visibility, colour and opacity">
            ☰ Layers
          </button>
          <button className={tool === 'measure' ? 'active' : ''} onClick={() => setState({ tool: tool === 'measure' ? (step === 'segment' ? 'seed' : 'select') : 'measure' })} title="Measure distance: click two points (M)">
            📏 Measure
          </button>
        </div>
      )}
      {hasScan && layersOpen && <LayersPanel onClose={() => setLayersOpen(false)} />}
      {busy && <div className="busy">{busy}</div>}
      {hasScan && planning && <Timeline />}
    </div>
  );
}

function Timeline() {
  const stage = useStudio((s) => s.stage);
  const staging = useStudio((s) => s.staging);
  const playing = useStudio((s) => s.playing);
  const protocol = useStudio((s) => s.protocol);
  const total = staging?.totalStages ?? 0;
  const week = Math.round((stage * protocol.staging.daysPerStage) / 7);
  return (
    <div className="timeline">
      <button className="icon" onClick={() => studio.setStage(0)} title="Initial (Home)">
        ⏮
      </button>
      <button className="icon" onClick={() => studio.setStage(stage - 1)} title="Previous stage ([)">
        ◀
      </button>
      <button className="icon" onClick={() => setState({ playing: !playing })} disabled={!total} title="Play (Space)">
        {playing ? '⏸' : '▶'}
      </button>
      <button className="icon" onClick={() => studio.setStage(stage + 1)} title="Next stage (])">
        ▶
      </button>
      <button className="icon" onClick={() => studio.setStage(total)} title="Final (End)">
        ⏭
      </button>
      <input type="range" min={0} max={Math.max(total, 0)} step={1} value={stage} disabled={!total} onChange={(e) => studio.setStage(+e.target.value)} className="grow" />
      <div className="stage-label">
        {stage === 0 ? 'Initial' : stage === total ? `Final · stage ${stage}` : `Stage ${stage}`} / {total}
        <span className="muted small"> · wk {week}</span>
      </div>
    </div>
  );
}
