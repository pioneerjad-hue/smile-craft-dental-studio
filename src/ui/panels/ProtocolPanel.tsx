import { useRef, useState } from 'react';
import { TOOTH_TYPES, TOOTH_TYPE_LABEL } from '../../core/fdi';
import { applyAiPlan } from '../../core/aiBrief';
import { defaultProtocol, normalizeProtocol } from '../../core/protocol';
import { ATTACHMENT_LABEL } from '../../core/types';
import type { AttachmentType, Protocol, StageLimits, TotalLimits } from '../../core/types';
import { download, safeName } from '../../engine/project';
import { exportPlanningBrief } from '../../engine/exporter';
import { getState, setState, toast, useStudio } from '../../engine/store';
import { studio } from '../../engine/studio';
import { NumberInput } from '../common';

const STAGE_FIELDS: [keyof StageLimits, string][] = [
  ['translationMm', 'Translation mm'],
  ['extrusionMm', 'Extrusion mm'],
  ['intrusionMm', 'Intrusion mm'],
  ['tipDeg', 'Tip °'],
  ['torqueDeg', 'Torque °'],
  ['rotationDeg', 'Rotation °'],
  ['crownDisplacementMm', 'Crown step mm'],
];
const TOTAL_FIELDS: [keyof TotalLimits, string][] = [
  ['translationMm', 'Translation mm'],
  ['extrusionMm', 'Extrusion mm'],
  ['intrusionMm', 'Intrusion mm'],
  ['tipDeg', 'Tip °'],
  ['torqueDeg', 'Torque °'],
  ['rotationDeg', 'Rotation °'],
];

export function ProtocolPanel() {
  const protocol = useStudio((s) => s.protocol);
  const [tab, setTab] = useState<'rules' | 'json' | 'ai'>('rules');
  const set = (p: Protocol) => studio.setProtocol(p);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className="section">
        <h3>Protocol</h3>
        <input type="text" value={protocol.name} onChange={(e) => set({ ...protocol, name: e.target.value })} />
        <div className="row wrap">
          <button onClick={() => download(JSON.stringify(protocol, null, 2), `${safeName(protocol.name, 'protocol')}.protocol.json`, 'application/json')}>Export</button>
          <button onClick={() => fileRef.current?.click()}>Import</button>
          <button className="danger" onClick={() => confirm('Reset protocol to defaults?') && set(defaultProtocol())}>
            Defaults
          </button>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept=".json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                set(normalizeProtocol(JSON.parse(await f.text())));
                toast('Protocol imported.', 'success');
              } catch (err) {
                toast(`Invalid protocol: ${(err as Error).message}`, 'error');
              }
            }}
          />
        </div>
        <div className="hint small">Save your protocols as files to reuse them on every case — and to hand them to the AI planner.</div>
      </div>
      <div className="tabs">
        <button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>
          Rules
        </button>
        <button className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>
          JSON
        </button>
        <button className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}>
          AI planner
        </button>
      </div>
      {tab === 'rules' && <RulesEditor protocol={protocol} set={set} />}
      {tab === 'json' && <JsonEditor protocol={protocol} set={set} />}
      {tab === 'ai' && <AiPanel />}
    </>
  );
}

function RulesEditor({ protocol, set }: { protocol: Protocol; set: (p: Protocol) => void }) {
  const limits = protocol.staging.limits;
  const total = protocol.totalLimits;
  return (
    <>
      <div className="section">
        <h3>Per-aligner limits</h3>
        {STAGE_FIELDS.map(([k, label]) => (
          <div className="field" key={k}>
            <label>{label}</label>
            <NumberInput value={limits[k]} step={0.05} min={0.01} onChange={(v) => set({ ...protocol, staging: { ...protocol.staging, limits: { ...limits, [k]: v } } })} />
          </div>
        ))}
        <div className="field">
          <label>Max aligners</label>
          <NumberInput value={protocol.staging.maxStages} step={1} digits={0} min={1} onChange={(v) => set({ ...protocol, staging: { ...protocol.staging, maxStages: Math.round(v) } })} />
        </div>
        <details>
          <summary>Overrides by tooth type</summary>
          <table className="grid">
            <thead>
              <tr>
                <th>Type</th>
                <th>Trans</th>
                <th>Rot °</th>
              </tr>
            </thead>
            <tbody>
              {TOOTH_TYPES.map((t) => {
                const o = protocol.staging.overrides[t] ?? {};
                const upd = (patch: Partial<StageLimits>) => set({ ...protocol, staging: { ...protocol.staging, overrides: { ...protocol.staging.overrides, [t]: { ...o, ...patch } } } });
                return (
                  <tr key={t}>
                    <td>{TOOTH_TYPE_LABEL[t]}</td>
                    <td>
                      <NumberInput width={52} value={o.translationMm ?? limits.translationMm} step={0.05} onChange={(v) => upd({ translationMm: v })} />
                    </td>
                    <td>
                      <NumberInput width={52} value={o.rotationDeg ?? limits.rotationDeg} step={0.25} onChange={(v) => upd({ rotationDeg: v })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      </div>
      <div className="section">
        <h3>Constraints</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!protocol.constraints?.enforceTotalLimits}
            onChange={(e) => {
              set({ ...protocol, constraints: { ...protocol.constraints, enforceTotalLimits: e.target.checked } });
              if (e.target.checked) {
                const n = studio.enforceConstraints();
                if (n) toast(`${n} tooth/teeth clamped to the protocol limits.`, 'info');
              }
            }}
          />
          Enforce total limits as hard constraints (clamp instead of warn)
        </label>
        <div className="hint small">
          Per-tooth constraints live in the tooth inspector: 🔒 locks a single axis (e.g. no torque on 13), "Fixed / anchor"
          holds a tooth completely. Constraints apply to manual edits and to imported AI plans.
        </div>
      </div>
      <div className="section">
        <h3>Total movement limits</h3>
        {TOTAL_FIELDS.map(([k, label]) => (
          <div className="field" key={k}>
            <label>{label}</label>
            <NumberInput value={total[k]} step={0.5} min={0} onChange={(v) => set({ ...protocol, totalLimits: { ...total, [k]: v } })} />
          </div>
        ))}
      </div>
      <div className="section">
        <h3>IPR</h3>
        {(
          [
            ['maxPerContactMm', 'Max / contact'],
            ['maxPerContactAnteriorMm', 'Max anterior'],
            ['maxTotalPerArchMm', 'Max / arch'],
            ['stepMm', 'Rounding step'],
            ['overlapToleranceMm', 'Tolerance'],
          ] as const
        ).map(([k, label]) => (
          <div className="field" key={k}>
            <label>{label} mm</label>
            <NumberInput value={protocol.ipr[k]} step={0.05} min={0} onChange={(v) => set({ ...protocol, ipr: { ...protocol.ipr, [k]: v } })} />
          </div>
        ))}
        <div className="field">
          <label>Default stage</label>
          <NumberInput value={protocol.ipr.defaultStage} step={1} digits={0} min={0} onChange={(v) => set({ ...protocol, ipr: { ...protocol.ipr, defaultStage: Math.round(v) } })} />
        </div>
      </div>
      <div className="section">
        <h3>Attachment rules</h3>
        {protocol.attachments.rules.map((r, i) => {
          const upd = (patch: Partial<typeof r>) => {
            const rules = protocol.attachments.rules.slice();
            rules[i] = { ...r, ...patch };
            set({ ...protocol, attachments: { ...protocol.attachments, rules } });
          };
          return (
            <div className="card" key={r.id}>
              <div className="small muted mono">{r.id}</div>
              <div className="small">{r.description}</div>
              <div className="row small" style={{ marginTop: 6 }}>
                <span className="muted">{r.trigger} ≥</span>
                <NumberInput width={56} value={r.threshold} step={0.5} min={0} onChange={(v) => upd({ threshold: v })} />
                <select value={r.attachment} onChange={(e) => upd({ attachment: e.target.value as AttachmentType })}>
                  {Object.entries(ATTACHMENT_LABEL).map(([t, l]) => (
                    <option key={t} value={t}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
        <div className="hint small">Add or edit rules (trigger, tooth types) in the JSON tab.</div>
      </div>
      <div className="section">
        <h3>Centre of rotation (mm apical of crown centre)</h3>
        {TOOTH_TYPES.map((t) => (
          <div className="field" key={t}>
            <label>{TOOTH_TYPE_LABEL[t]}</label>
            <NumberInput
              value={protocol.biomechanics.pivotApicalMm[t]}
              step={0.5}
              min={0}
              onChange={(v) => set({ ...protocol, biomechanics: { pivotApicalMm: { ...protocol.biomechanics.pivotApicalMm, [t]: v } } })}
            />
          </div>
        ))}
      </div>
      <div className="section">
        <h3>Clinical rules (free text, for the AI)</h3>
        <textarea rows={6} value={protocol.clinicalNotes} onChange={(e) => set({ ...protocol, clinicalNotes: e.target.value })} />
      </div>
    </>
  );
}

function JsonEditor({ protocol, set }: { protocol: Protocol; set: (p: Protocol) => void }) {
  const [text, setText] = useState(() => JSON.stringify(protocol, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="section">
      <textarea className="mono" rows={28} value={text} onChange={(e) => setText(e.target.value)} style={{ fontSize: 11 }} />
      {error && <div className="small" style={{ color: 'var(--bad)' }}>{error}</div>}
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            try {
              set(normalizeProtocol(JSON.parse(text)));
              setError(null);
              toast('Protocol applied.', 'success');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Apply
        </button>
        <button onClick={() => setText(JSON.stringify(protocol, null, 2))}>Revert</button>
      </div>
    </div>
  );
}

function AiPanel() {
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const rationale = useStudio((s) => s.aiRationale);
  const fileRef = useRef<HTMLInputElement>(null);
  const importPlan = (raw: string) => {
    try {
      const json = JSON.parse(raw.replace(/^```(json)?|```$/gm, ''));
      const s = getState();
      const res = applyAiPlan(s.plan, json, s.teeth, s.protocol);
      studio.setPlan(res.plan);
      setProblems(res.problems);
      setState({ aiRationale: res.rationale ?? null, stage: 0 });
      toast('AI plan applied — review it in Plan and Stage & check. Undo with Ctrl+Z.', 'success');
    } catch (e) {
      toast(`Could not read AI plan: ${(e as Error).message}`, 'error');
    }
  };
  return (
    <>
      <div className="section">
        <div className="hint">
          The AI planner works from <b>your protocol</b>. Step 1 exports a planning brief with every tooth's position,
          axes, widths, contacts, Bolton and space analysis, your rules and the exact answer format. Step 2 imports the
          AI's proposed movements; the studio re-validates them against the protocol and you approve or edit them.
        </div>
        <button className="primary" onClick={exportPlanningBrief}>
          1 · Export planning brief (JSON)
        </button>
      </div>
      <div className="section">
        <h3>2 · Import AI plan</h3>
        <textarea className="mono" rows={8} style={{ fontSize: 11 }} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"format":"smile-craft/ai-plan@1","teeth":{"12":{"buccal":1.2,"rotation":-10}}, "ipr":[...]}' />
        <div className="row">
          <button disabled={!text.trim()} onClick={() => importPlan(text)}>
            Apply pasted plan
          </button>
          <button onClick={() => fileRef.current?.click()}>From file…</button>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept=".json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) importPlan(await f.text());
            }}
          />
        </div>
        {problems.length > 0 && (
          <div className="issues">
            {problems.map((p, i) => (
              <div className="issue warning" key={i}>
                {p}
              </div>
            ))}
          </div>
        )}
        {rationale && (
          <div className="card small">
            <b>AI rationale</b>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{rationale}</div>
          </div>
        )}
      </div>
    </>
  );
}
