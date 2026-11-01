import { LOWER_SEQUENCE, UPPER_SEQUENCE, contralateral, shortLabel, sortTeeth, toothName } from '../../core/fdi';
import { limitsFor } from '../../core/staging';
import { crownDisplacement, movementMatrix, v3 } from '../../core/transform';
import { ATTACHMENT_LABEL, MOVEMENT_KEYS, MOVEMENT_META, isZeroMovement } from '../../core/types';
import type { AttachmentType, MovementKey, StageLimits } from '../../core/types';
import { newAttachment } from '../../core/aiBrief';
import { triggeredAttachmentRules } from '../../core/validate';
import { setState, toast, useStudio } from '../../engine/store';
import { studio } from '../../engine/studio';
import { goToStep } from '../App';
import { IssuesList, NumberInput, Odontogram } from '../common';

const SHORT: Record<MovementKey, string> = { mesial: 'M/D', buccal: 'B/L', extrusion: 'E/I', tip: 'Tip', torque: 'Trq', rotation: 'Rot' };

export function PlanPanel() {
  const selected = useStudio((s) => s.selectedTooth);
  const plan = useStudio((s) => s.plan);
  const staging = useStudio((s) => s.staging);
  const issues = useStudio((s) => s.issues);
  const ids = sortTeeth(Object.keys(plan.teeth).map(Number));
  const moving = ids.filter((id) => !isZeroMovement(plan.teeth[id].movement));

  return (
    <>
      <div className="section">
        <h3>Select tooth</h3>
        <Odontogram current={selected} onPick={(id) => setState({ selectedTooth: id })} mode="plan" />
        <div className="hint small">Click a tooth here or in the 3D view, then drag the navigator: arrows move it (red mesial-distal, green buccal-lingual, blue extrusion-intrusion), rings rotate it (cyan rotation, orange tip, violet torque).</div>
      </div>

      <div className="stat">
        <div>
          <b>{staging?.totalStages ?? 0}</b>
          <span>aligners</span>
        </div>
        <div>
          <b>{Math.ceil(staging?.weeks ?? 0)}</b>
          <span>weeks</span>
        </div>
        <div>
          <b style={{ color: issues.some((i) => i.severity === 'error') ? 'var(--bad)' : issues.length ? 'var(--warn)' : 'var(--good)' }}>{issues.length}</b>
          <span>issues</span>
        </div>
      </div>

      <div className="section">
        <div className="row between">
          <h3 style={{ margin: 0 }}>Movement table</h3>
          <span className="small muted">{moving.length} moving</span>
        </div>
        <div style={{ maxHeight: 290, overflowY: 'auto' }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Tooth</th>
                {MOVEMENT_KEYS.map((k) => (
                  <th key={k} title={MOVEMENT_META[k].label}>
                    {SHORT[k]}
                  </th>
                ))}
                <th title="Stages needed">Stg</th>
              </tr>
            </thead>
            <tbody>
              {ids.map((id) => {
                const m = plan.teeth[id].movement;
                const st = staging?.teeth[id];
                return (
                  <tr key={id} className={`click ${selected === id ? 'sel' : ''}`} onClick={() => setState({ selectedTooth: id })}>
                    <td>
                      <b>{id}</b>
                    </td>
                    {MOVEMENT_KEYS.map((k) => (
                      <td key={k} className={m[k] > 0 ? 'pos' : m[k] < 0 ? 'neg' : 'muted'}>
                        {Math.abs(m[k]) < 1e-6 ? '·' : m[k].toFixed(MOVEMENT_META[k].unit === 'mm' ? 1 : 0)}
                      </td>
                    ))}
                    <td>{st?.stagesNeeded || '·'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row wrap">
          <button
            onClick={() => {
              const n = studio.autoAttachments();
              toast(n ? `Added ${n} attachment(s) required by the protocol.` : 'No additional attachments required.', n ? 'success' : 'info');
            }}
          >
            Auto attachments
          </button>
          <button className="danger" onClick={() => confirm('Reset all movements and IPR?') && studio.resetAllMovements()}>
            Reset all
          </button>
        </div>
      </div>

      <div className="section">
        <h3>Protocol check</h3>
        <IssuesList issues={issues} limit={6} onPickTooth={(id) => setState({ selectedTooth: id })} />
      </div>
      <PonticSection />
      <div className="section">
        <h3>Plan notes</h3>
        <textarea rows={3} value={plan.notes} onChange={(e) => studio.setPlan({ ...plan, notes: e.target.value }, false)} placeholder="Treatment goals, refinement plans, auxiliaries…" />
      </div>
      <button className="primary" onClick={() => goToStep('stage')}>
        Stage & check →
      </button>
    </>
  );
}

function dofLimit(l: StageLimits, k: MovementKey, v: number) {
  if (k === 'mesial' || k === 'buccal') return l.translationMm;
  if (k === 'extrusion') return v >= 0 ? l.extrusionMm : l.intrusionMm;
  if (k === 'tip') return l.tipDeg;
  if (k === 'torque') return l.torqueDeg;
  return l.rotationDeg;
}

export function ToothInspector() {
  const id = useStudio((s) => s.selectedTooth);
  const plan = useStudio((s) => s.plan);
  const frames = useStudio((s) => s.frames);
  const staging = useStudio((s) => s.staging);
  const protocol = useStudio((s) => s.protocol);
  const issues = useStudio((s) => s.issues);
  if (id === null || !plan.teeth[id]) {
    return (
      <div className="hint">
        <h3>Tooth inspector</h3>
        Select a tooth to edit its movement.
        <br />
        <br />
        <b>Shortcuts</b>
        <br />
        <span className="kbd">1</span>–<span className="kbd">5</span> views · <span className="kbd">[</span>{' '}
        <span className="kbd">]</span> stage · <span className="kbd">Space</span> play · <span className="kbd">G</span> initial overlay ·{' '}
        <span className="kbd">M</span> measure · <span className="kbd">Ctrl+Z</span> undo
      </div>
    );
  }
  const tp = plan.teeth[id];
  const frame = frames[id];
  const st = staging?.teeth[id];
  const limits = limitsFor(protocol, id);
  const disp = frame ? crownDisplacement(frame, tp.movement) : null;
  const apexMove = frame?.apex ? v3(frame.apex).applyMatrix4(movementMatrix(frame, tp.movement)).distanceTo(v3(frame.apex)) : null;
  const mirror = contralateral(id);
  const required = triggeredAttachmentRules(protocol, id, tp.movement);
  const toothIssues = issues.filter((i) => i.tooth === id);

  const measureWidth = () => {
    setState({ tool: 'measure' });
    toast(`Click the mesial and distal contact points of ${id}.`);
    studio.onMeasure = (d) => {
      studio.updateTooth(id, { manualWidthMm: Math.round(d * 100) / 100 });
      studio.onMeasure = null;
      setState({ tool: 'select', measurements: [] });
      toast(`Width of ${id} set to ${d.toFixed(2)} mm`, 'success');
    };
  };

  return (
    <>
      <div className="section">
        <div className="row between">
          <div>
            <h3 style={{ margin: 0 }}>
              {id} · {shortLabel(id)}
            </h3>
            <div className="small muted">{toothName(id)}</div>
          </div>
          <button className="icon" onClick={() => setState({ selectedTooth: null })} title="Deselect (Esc)">
            ✕
          </button>
        </div>
        <div className="card" style={{ padding: '4px 10px' }}>
          {MOVEMENT_KEYS.map((k) => {
            const meta = MOVEMENT_META[k];
            const v = tp.movement[k];
            const lim = dofLimit(limits, k, v);
            const need = lim > 0 ? Math.ceil(Math.abs(v) / lim - 1e-9) : 0;
            const total = Math.max(1, st?.end && st.end > st.start ? st.end - st.start : need);
            const isLimit = st?.limitingFactor === k;
            const axisLocked = !!tp.lockedAxes?.includes(k);
            return (
              <div className={`mv ${axisLocked ? 'locked' : ''}`} key={k}>
                <div>
                  <div className="name">{meta.label}</div>
                  <div className="dir">
                    {Math.abs(v) < 1e-9 ? `+ ${meta.positive} / − ${meta.negative}` : v > 0 ? meta.positive : meta.negative}
                    {need > 0 && ` · ${need} stg @ ${lim}${meta.unit}`}
                  </div>
                </div>
                <div className="ctrl">
                  <button className={`lock ${axisLocked ? 'on' : ''}`} title={axisLocked ? 'Constraint: axis locked at 0 — click to unlock' : 'Lock this axis (constraint)'} onClick={() => studio.toggleAxisLock(id, k)}>
                    {axisLocked ? '🔒' : '🔓'}
                  </button>
                  <button className="icon" disabled={tp.locked || axisLocked} onClick={() => studio.setMovement(id, { [k]: v - meta.step })}>
                    −
                  </button>
                  <NumberInput value={v} step={meta.step} digits={meta.unit === 'mm' ? 2 : 1} onChange={(nv, rec) => studio.setMovement(id, { [k]: nv }, rec)} />
                  <button className="icon" disabled={tp.locked || axisLocked} onClick={() => studio.setMovement(id, { [k]: v + meta.step })}>
                    +
                  </button>
                  <span className="unit">{meta.unit}</span>
                </div>
                <div className="stagecost" title={`${need} of ${total} stages`}>
                  <i className={isLimit ? 'limit' : ''} style={{ width: `${Math.min(100, (need / total) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        {disp && (
          <div className="small muted">
            Crown centre moves {disp.total.toFixed(2)} mm (M {disp.mesial.toFixed(2)}, B {disp.buccal.toFixed(2)}, O {disp.occlusal.toFixed(2)})
            {apexMove !== null && ` · root apex moves ${apexMove.toFixed(2)} mm`}
            {st && st.stagesNeeded > 0 && (
              <>
                {' '}
                · stages {st.start}–{st.end}
                {st.limitingFactor && ` · limited by ${st.limitingFactor}`} · max crown step {st.maxCrownStepMm.toFixed(2)} mm
              </>
            )}
          </div>
        )}
        <div className="row wrap">
          <button onClick={() => studio.resetTooth(id)}>Reset</button>
          <button onClick={() => studio.mirrorTooth(id, mirror)} disabled={!plan.teeth[mirror]} title="Apply same values to the contralateral tooth">
            Copy → {mirror}
          </button>
          <button onClick={() => studio.mirrorTooth(mirror, id)} disabled={!plan.teeth[mirror]}>
            Copy ← {mirror}
          </button>
        </div>
      </div>

      <div className="section">
        <div className="field">
          <label>Start at stage</label>
          <NumberInput value={tp.startStage} step={1} min={0} digits={0} onChange={(v) => studio.updateTooth(id, { startStage: Math.round(v) })} />
        </div>
        <div className="field">
          <label title="Teeth in layer 2 start moving when layer 1 has finished, and so on">Staging layer</label>
          <NumberInput value={tp.layer ?? 1} step={1} min={1} max={12} digits={0} onChange={(v) => studio.updateTooth(id, { layer: Math.max(1, Math.round(v)) })} />
        </div>
        <div className="row">
          <label className="checkbox">
            <input type="checkbox" checked={!!tp.locked} onChange={(e) => studio.updateTooth(id, e.target.checked ? { locked: true, movement: { mesial: 0, buccal: 0, extrusion: 0, tip: 0, torque: 0, rotation: 0 } } : { locked: false })} /> Fixed / anchor tooth (implant, bridge)
          </label>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={!!tp.extracted} onChange={(e) => studio.updateTooth(id, { extracted: e.target.checked })} /> Planned extraction
        </label>
        <div className="field">
          <label>MD width</label>
          <div className="row">
            <span className="mono">{(tp.manualWidthMm ?? frame?.autoWidthMm ?? 0).toFixed(2)} mm</span>
            <span className="small muted">{tp.manualWidthMm !== undefined ? 'measured' : 'auto'}</span>
            <div className="grow" />
            <button className="icon" onClick={measureWidth} title="Measure contact to contact">
              📏
            </button>
            {tp.manualWidthMm !== undefined && (
              <button className="icon" onClick={() => studio.updateTooth(id, { manualWidthMm: undefined })} title="Back to auto">
                ↺
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="section">
        <h3>Attachments</h3>
        {required.length > 0 && (
          <div className="small" style={{ color: 'var(--warn)' }}>
            Protocol requires: {required.map((r) => ATTACHMENT_LABEL[r.attachment]).join(', ')}
          </div>
        )}
        {tp.attachments.map((a) => (
          <div className="card" key={a.id}>
            <div className="row between">
              <select value={a.type} onChange={(e) => studio.updateAttachment(id, a.id, { type: e.target.value as AttachmentType })}>
                {Object.entries(ATTACHMENT_LABEL).map(([t, l]) => (
                  <option key={t} value={t}>
                    {l}
                  </option>
                ))}
              </select>
              <button className="icon danger" onClick={() => studio.removeAttachment(id, a.id)}>
                ✕
              </button>
            </div>
            <div className="row small" style={{ marginTop: 6 }}>
              <span className="muted">Occl.</span>
              <NumberInput width={56} value={a.offsetOcclusalMm} step={0.25} onChange={(v) => studio.updateAttachment(id, a.id, { offsetOcclusalMm: v })} />
              <span className="muted">Mes.</span>
              <NumberInput width={56} value={a.offsetMesialMm} step={0.25} onChange={(v) => studio.updateAttachment(id, a.id, { offsetMesialMm: v })} />
              <span className="muted">from</span>
              <NumberInput width={44} value={a.stageFrom} step={1} min={0} digits={0} onChange={(v) => studio.updateAttachment(id, a.id, { stageFrom: Math.round(v) })} />
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {a.size.join(' × ')} mm{a.reason ? ` · ${a.reason}` : ''}
            </div>
          </div>
        ))}
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) studio.addAttachment(id, newAttachment(e.target.value as AttachmentType, protocol.attachments.defaultStage, 'manual'));
          }}
        >
          <option value="">+ Add attachment…</option>
          {Object.entries(ATTACHMENT_LABEL).map(([t, l]) => (
            <option key={t} value={t}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {toothIssues.length > 0 && (
        <div className="section">
          <h3>Issues</h3>
          <IssuesList issues={toothIssues} />
        </div>
      )}
      <div className="section">
        <label>Tooth note</label>
        <textarea rows={2} value={tp.note ?? ''} onChange={(e) => studio.updateTooth(id, { note: e.target.value }, false)} />
      </div>
    </>
  );
}

function PonticSection() {
  const teeth = useStudio((s) => s.teeth);
  const ponticsRaw = useStudio((s) => s.plan.pontics);
  const pontics = ponticsRaw ?? [];
  const arches = useStudio((s) => s.arches);
  const absent = [...(arches.upper ? UPPER_SEQUENCE : []), ...(arches.lower ? LOWER_SEQUENCE : [])].filter(
    (id) => id % 10 <= 7 && !teeth.includes(id) && !pontics.some((p) => p.id === id),
  );
  return (
    <div className="section">
      <h3>Pontics (missing teeth)</h3>
      <div className="hint small">Fills a space with the mirrored crown of the opposite-side tooth. It follows its neighbours through the stages and is printed on the models. Extractions: tick "Planned extraction" in the tooth inspector.</div>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) studio.addPontic(+e.target.value);
        }}
      >
        <option value="">+ Add pontic for…</option>
        {absent.map((id) => (
          <option key={id} value={id}>
            {id} · {toothName(id)}
          </option>
        ))}
      </select>
      {pontics.map((p) => (
        <div className="card" key={p.id}>
          <div className="row between">
            <b>
              {p.id} <span className="muted small">mirror of {p.source}</span>
            </b>
            <button className="icon danger" onClick={() => studio.removePontic(p.id)}>
              ✕
            </button>
          </div>
          <div className="row small" style={{ marginTop: 6 }}>
            {(['R/L', 'Ant', 'Up'] as const).map((label, k) => (
              <span key={label} className="row" style={{ gap: 3 }}>
                <span className="muted">{label}</span>
                <NumberInput
                  width={50}
                  value={p.offset[k]}
                  step={0.1}
                  onChange={(v) => {
                    const o = [...p.offset] as [number, number, number];
                    o[k] = v;
                    studio.updatePontic(p.id, { offset: o });
                  }}
                />
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
