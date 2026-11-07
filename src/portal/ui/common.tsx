import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { LOWER_SEQUENCE, UPPER_SEQUENCE, shortLabel, toothName } from '../../core/fdi';
import { STATUS_LABEL } from '../model';
import type { CaseStatus, RecordFile } from '../model';
import { getBlob } from '../blobs';
import { PIPELINE, pipelineIndex } from '../workflow';
import { usePortal } from '../store';

/* ------------------------------------------------------------------ routing */

export function useRoute(): string[] {
  const read = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard').split('/');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const hashQuery = () => new URLSearchParams(location.hash.split('?')[1] ?? '');

export const go = (path: string) => {
  location.hash = `#/${path}`;
};

/* ------------------------------------------------------------------ formatting */

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}

/* ------------------------------------------------------------------ small components */

const STATUS_TONE: Record<CaseStatus, string> = {
  draft: 'neutral',
  submitted: 'info',
  records_issue: 'danger',
  planning: 'info',
  plan_ready: 'action',
  modification_requested: 'warn',
  approved: 'good',
  manufacturing: 'info',
  shipped: 'info',
  in_treatment: 'good',
  refinement: 'warn',
  retention: 'good',
  completed: 'neutral',
  cancelled: 'neutral',
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`badge tone-${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function Pipeline({ status }: { status: CaseStatus }) {
  const idx = pipelineIndex(status);
  if (status === 'cancelled') return <div className="pipeline cancelled">Case cancelled</div>;
  return (
    <ol className="pipeline" aria-label="Case progress">
      {PIPELINE.map((p, i) => (
        <li key={p.label} className={i < idx || status === 'completed' ? 'done' : i === idx ? 'current' : ''} aria-current={i === idx ? 'step' : undefined}>
          <span className="dot">{i < idx || status === 'completed' ? '✓' : i + 1}</span>
          <span className="lbl">{p.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = usePortal((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Object URL for a stored record blob (photos / x-rays). */
export function useBlobUrl(rec: RecordFile | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    setUrl(null);
    if (rec?.hasBlob && (rec.kind === 'photo' || rec.kind === 'xray') && rec.mime.startsWith('image/')) {
      getBlob(rec.id)
        .then((b) => {
          if (b && live) {
            u = URL.createObjectURL(b);
            setUrl(u);
          }
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [rec?.id, rec?.hasBlob, rec?.kind, rec?.mime]);
  return url;
}

/** FDI tooth picker – used for "do not move", "no attachments" and "extract" in the Rx, and for plan comments. */
export function ToothPicker({
  marks,
  onToggle,
  legend,
}: {
  marks: Record<number, string | undefined>;
  onToggle: (id: number) => void;
  legend?: ReactNode;
}) {
  const cell = (id: number) => (
    <button key={id} type="button" className={`tp-tooth ${marks[id] ?? ''}`} title={`${id} · ${shortLabel(id)} · ${toothName(id)}`} onClick={() => onToggle(id)} aria-pressed={!!marks[id]}>
      {id}
    </button>
  );
  return (
    <div className="tooth-picker">
      <div className="tp-sides muted small">
        <span>Patient right</span>
        <span>Patient left</span>
      </div>
      <div className="tp-row">{UPPER_SEQUENCE.map(cell)}</div>
      <div className="tp-row">{LOWER_SEQUENCE.map(cell)}</div>
      {legend && <div className="tp-legend small muted">{legend}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, name }: { value: T; options: [T, string][]; onChange: (v: T) => void; name: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={name}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}
