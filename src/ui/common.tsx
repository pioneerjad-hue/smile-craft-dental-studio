import { useEffect, useRef, useState } from 'react';
import { LOWER_SEQUENCE, UPPER_SEQUENCE, shortLabel, toothName } from '../core/fdi';
import { isZeroMovement } from '../core/types';
import type { Issue } from '../core/types';
import { setState, useStudio } from '../engine/store';

/** Clickable FDI tooth chart. */
export function Odontogram({ current, onPick, mode }: { current: number | null; onPick: (id: number) => void; mode: 'segment' | 'plan' }) {
  const teeth = useStudio((s) => s.teeth);
  const plan = useStudio((s) => s.plan);
  const issues = useStudio((s) => s.issues);
  const present = new Set(teeth);
  const withIssue = new Set(issues.filter((i) => i.tooth).map((i) => i.tooth!));
  const cell = (id: number) => {
    const tp = plan.teeth[id];
    const cls = ['tooth-btn'];
    if (present.has(id)) cls.push('seg');
    else if (mode === 'plan') cls.push('absent');
    if (tp && !isZeroMovement(tp.movement)) cls.push('moving');
    if (tp?.locked) cls.push('locked');
    if (tp?.extracted) cls.push('extracted');
    if (mode === 'plan' && withIssue.has(id)) cls.push('issue');
    if (current === id) cls.push('current');
    return (
      <button
        key={id}
        className={cls.join(' ')}
        title={`${id} · ${shortLabel(id)} · ${toothName(id)}${present.has(id) ? '' : ' (not segmented)'}`}
        disabled={mode === 'plan' && !present.has(id)}
        onClick={() => onPick(id)}
      >
        {id}
      </button>
    );
  };
  return (
    <div className="odonto">
      <div className="row between small muted">
        <span>Patient right</span>
        <span>Patient left</span>
      </div>
      <div className="arch-row">{UPPER_SEQUENCE.map(cell)}</div>
      <div className="midline" />
      <div className="arch-row">{LOWER_SEQUENCE.map(cell)}</div>
    </div>
  );
}

/**
 * Number input that applies valid values live. `record` is true for the first change of an editing
 * session (so the caller can push one undo snapshot per edit, not per keystroke).
 */
export function NumberInput({ value, onChange, step = 0.1, min, max, width, digits = 2 }: { value: number; onChange: (v: number, record: boolean) => void; step?: number; min?: number; max?: number; width?: number; digits?: number }) {
  const [text, setText] = useState(value.toFixed(digits));
  const focused = useRef(false);
  const recorded = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value.toFixed(digits));
  }, [value, digits]);
  const apply = (raw: string) => {
    const v = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    if (Math.abs(c - value) < 1e-9) return;
    onChange(c, !recorded.current);
    recorded.current = true;
  };
  return (
    <input
      type="number"
      step={step}
      value={text}
      style={width ? { width } : undefined}
      onFocus={(e) => {
        focused.current = true;
        recorded.current = false;
        e.target.select();
      }}
      onBlur={() => {
        focused.current = false;
        apply(text);
        setText(value.toFixed(digits));
      }}
      onChange={(e) => {
        setText(e.target.value);
        apply(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

export function IssuesList({ issues, onPickTooth, limit }: { issues: Issue[]; onPickTooth?: (id: number) => void; limit?: number }) {
  const shown = limit ? issues.slice(0, limit) : issues;
  if (!issues.length) return <div className="pill good">All protocol checks passed</div>;
  return (
    <div className="issues">
      {shown.map((i, k) => (
        <div
          key={k}
          className={`issue ${i.severity} ${i.tooth && onPickTooth ? 'clickable' : ''}`}
          onClick={() => i.tooth && onPickTooth?.(i.tooth)}
        >
          <div className="rule">
            {i.severity.toUpperCase()} · {i.rule}
          </div>
          {i.message}
        </div>
      ))}
      {limit && issues.length > limit && <div className="muted small">+ {issues.length - limit} more</div>}
    </div>
  );
}

export function Toast() {
  const toast = useStudio((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setState({ toast: null }), toast.kind === 'error' ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return <div className={`toast ${toast.kind}`}>{toast.text}</div>;
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function useSettings() {
  const settings = useStudio((s) => s.settings);
  const set = (patch: Partial<typeof settings>) => setState((s) => ({ settings: { ...s.settings, ...patch } }));
  return [settings, set] as const;
}
