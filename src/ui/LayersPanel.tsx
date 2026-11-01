import type { Arch } from '../core/fdi';
import { LAYER_LABEL, setState, useStudio } from '../engine/store';
import type { LayerId } from '../engine/store';
import { useSettings } from './common';

function LayerRow({ id }: { id: LayerId }) {
  const style = useStudio((s) => s.layers[id]);
  const set = (patch: Partial<typeof style>) => setState((s) => ({ layers: { ...s.layers, [id]: { ...s.layers[id], ...patch } } }));
  return (
    <div className="layer-row">
      <button className={`icon eye ${style.visible ? 'on' : ''}`} onClick={() => set({ visible: !style.visible })} title={style.visible ? 'Hide' : 'Show'}>
        {style.visible ? '●' : '○'}
      </button>
      <span className="grow">{LAYER_LABEL[id]}</span>
      <input type="color" value={style.color} onChange={(e) => set({ color: e.target.value })} title="Colour" />
      <input type="range" min={0} max={1} step={0.05} value={style.opacity} onChange={(e) => set({ opacity: +e.target.value })} title={`Opacity ${Math.round(style.opacity * 100)}%`} />
    </div>
  );
}

export function LayersPanel({ onClose }: { onClose: () => void }) {
  const [settings, set] = useSettings();
  const arches = useStudio((s) => s.arches);
  const modelBuilder = useStudio((s) => s.modelBuilder);
  const step = useStudio((s) => s.step);
  const planning = step !== 'import' && step !== 'segment';
  const archRow = (arch: Arch) => {
    const key = arch === 'upper' ? 'showUpper' : 'showLower';
    const p = arch === 'upper' ? 'upper' : 'lower';
    return (
      <div key={arch} className="layer-group">
        <div className="layer-row head">
          <button className={`icon eye ${settings[key] ? 'on' : ''}`} onClick={() => set({ [key]: !settings[key] })}>
            {settings[key] ? '●' : '○'}
          </button>
          <b className="grow">{arch === 'upper' ? 'Upper arch' : 'Lower arch'}</b>
        </div>
        <LayerRow id={`${p}Gum` as LayerId} />
        <LayerRow id={`${p}Teeth` as LayerId} />
        <LayerRow id={`${p}Roots` as LayerId} />
        {modelBuilder.enabled && <LayerRow id={`${p}Base` as LayerId} />}
      </div>
    );
  };
  return (
    <div className="layers-panel">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Layers</h3>
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </div>
      {(['upper', 'lower'] as Arch[]).filter((a) => arches[a]).map(archRow)}
      {planning && (
        <div className="layer-group">
          {(
            [
              ['showAttachments', 'Attachments'],
              ['showGhost', 'Initial position overlay'],
              ['showAxes', 'Tooth axes'],
            ] as const
          ).map(([k, label]) => (
            <div className="layer-row" key={k}>
              <button className={`icon eye ${settings[k] ? 'on' : ''}`} onClick={() => set({ [k]: !settings[k] })}>
                {settings[k] ? '●' : '○'}
              </button>
              <span className="grow">{label}</span>
            </div>
          ))}
        </div>
      )}
      <div className="hint small">Lower the gingiva opacity to see the roots, crown margins and contacts through the gum.</div>
    </div>
  );
}
