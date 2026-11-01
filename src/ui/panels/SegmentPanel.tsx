import { archOf, shortLabel, toothName } from '../../core/fdi';
import { setState, useStudio } from '../../engine/store';
import { studio } from '../../engine/studio';
import { goToStep } from '../App';
import { Check, Odontogram, useSettings } from '../common';

export function SegmentPanel() {
  const active = useStudio((s) => s.activeTooth);
  const tool = useStudio((s) => s.tool);
  const teeth = useStudio((s) => s.teeth);
  const arches = useStudio((s) => s.arches);
  const [settings, set] = useSettings();
  const segmented = new Set(teeth);
  const archMissing = !arches[archOf(active)];
  const missingMode = tool === 'missing';
  const missingTeeth = useStudio((s) => s.missingTeeth);

  return (
    <>
      <div className="section">
        <h3>1 · Missing teeth</h3>
        <div className="hint small">Mark teeth that are not in the mouth (third molars are pre-marked). Auto-segmentation then numbers the remaining crowns correctly.</div>
        <button className={missingMode ? 'active' : ''} onClick={() => setState({ tool: missingMode ? 'seed' : 'missing' })}>
          {missingMode ? '✓ Done marking missing teeth' : '✕ Mark missing teeth'}
        </button>
        {missingMode && <div className="small" style={{ color: 'var(--warn)' }}>Click teeth in the chart to toggle missing: {missingTeeth.join(', ') || 'none'}</div>}
      </div>

      <div className="section">
        <h3>2 · Segment</h3>
        <button className="primary" onClick={() => studio.autoSegment()}>
          ✦ Auto-segment all teeth
        </button>
        <div className="hint">
          Then check the number on every crown. To fix: pick the right tooth in the chart and <b>click its crown</b>
          (this also renumbers a wrongly numbered crown). Brush to fix edges. You can also click each tooth yourself
          (17 → 27, 47 → 37 with auto-advance).
        </div>
        <Odontogram current={missingMode ? null : active} onPick={(id) => (missingMode ? studio.toggleMissing(id) : setState({ activeTooth: id, tool: tool === 'measure' ? 'seed' : tool }))} mode="segment" />
        <div className="card">
          <div className="row between">
            <div>
              <b>
                {active} · {shortLabel(active)}
              </b>
              <div className="small muted">{toothName(active)}</div>
            </div>
            {segmented.has(active) ? <span className="pill good">segmented</span> : <span className="pill">pending</span>}
          </div>
          {archMissing && <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>No {archOf(active)} scan loaded.</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <button disabled={!segmented.has(active)} onClick={() => studio.clearTooth(active)}>
              Clear tooth
            </button>
            <button onClick={() => studio.advanceActiveTooth()}>Next unsegmented →</button>
          </div>
        </div>
      </div>

      <div className="section">
        <h3>Tools</h3>
        <div className="row wrap">
          <button className={tool === 'seed' ? 'active' : ''} onClick={() => setState({ tool: 'seed' })} title="S">
            ✦ Smart click
          </button>
          <button className={tool === 'brushAdd' ? 'active' : ''} onClick={() => setState({ tool: 'brushAdd' })} title="B">
            ✚ Brush add
          </button>
          <button className={tool === 'brushErase' ? 'active' : ''} onClick={() => setState({ tool: 'brushErase' })} title="E">
            ✖ Brush to gum
          </button>
        </div>
        <div className="hint small">
          Smart click replaces the tooth's seed; <span className="kbd">Shift</span>+click adds an extra seed (e.g. a molar
          cusp that was missed). Brushes are hard corrections: paint the missing crown area, or paint gum where the tooth
          leaked. In brush mode rotate with the <b>right</b> mouse button.
        </div>
        {(tool === 'brushAdd' || tool === 'brushErase') && (
          <div>
            <label>Brush radius {settings.brushRadiusMm.toFixed(1)} mm</label>
            <input type="range" min={0.3} max={4} step={0.1} value={settings.brushRadiusMm} onChange={(e) => set({ brushRadiusMm: +e.target.value })} />
          </div>
        )}
        <Check checked={settings.autoAdvance} onChange={(v) => set({ autoAdvance: v })}>
          Auto-advance to next tooth after click
        </Check>
      </div>

      <details className="section">
        <summary>Advanced</summary>
        <div style={{ marginTop: 8 }}>
          <label>Seed reach ×{settings.seedReachScale.toFixed(2)} (large crowns / long incisors)</label>
          <input type="range" min={0.6} max={1.6} step={0.05} value={settings.seedReachScale} onChange={(e) => set({ seedReachScale: +e.target.value })} />
          <label>Crown tightness {settings.segTightness.toFixed(2)} (+ less gum on crowns, − bigger crowns)</label>
          <input type="range" min={-0.1} max={0.1} step={0.01} value={settings.segTightness} onChange={(e) => set({ segTightness: +e.target.value })} />
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={() => studio.resegmentAll()}>Re-run segmentation</button>
            <button className="danger" onClick={() => confirm('Clear all teeth?') && studio.clearAllSegmentation()}>
              Clear all
            </button>
          </div>
        </div>
      </details>

      <div className="grow" />
      <div className="small muted">{teeth.length} teeth segmented</div>
      <button className="primary" disabled={!teeth.length} onClick={() => goToStep('axes')}>
        Continue: check tooth axes →
      </button>
    </>
  );
}
