import { LOWER_SEQUENCE, UPPER_SEQUENCE, contactKey, shortLabel, toothName, toothNumber } from '../../core/fdi';
import type { PlanSummary, PlanTooth } from '../model';
import { formatMovement, isMoving, movementScore } from '../workflow';
import { MOVEMENT_KEYS } from '../../core/types';

const WIDTH: Record<number, number> = { 1: 8.6, 2: 6.8, 3: 7.8, 4: 7.1, 5: 6.8, 6: 10.2, 7: 9.6, 8: 9 };

interface Placed {
  id: number;
  x: number;
  y: number;
  r: number;
  angle: number;
}

/** Lay one arch out on a U-shaped curve, spacing teeth by typical crown width. */
function layout(seq: number[], present: Set<number>, upper: boolean, cx: number, cy: number): Placed[] {
  const ids = seq.filter((id) => present.has(id));
  const total = ids.reduce((s, id) => s + WIDTH[toothNumber(id)], 0);
  const T = 1.42;
  const A = 150;
  const B = 118;
  let acc = 0;
  return ids.map((id) => {
    const w = WIDTH[toothNumber(id)];
    const t = -T + ((acc + w / 2) / total) * 2 * T;
    acc += w;
    const x = cx + A * Math.sin(t);
    const y = upper ? cy - B * Math.cos(t) : cy + B * Math.cos(t);
    return { id, x, y, r: 5.5 + w * 0.95, angle: t };
  });
}

function color(t: PlanTooth | undefined): string {
  if (!t || !isMoving(t)) return 'var(--tooth)';
  const s = movementScore(t);
  // Light teal → deep teal by magnitude.
  return `color-mix(in oklab, var(--move-hi) ${Math.round(25 + s * 75)}%, var(--tooth))`;
}

export function ArchChart({
  plan,
  selected,
  onPick,
  comments,
  flagged,
}: {
  plan: PlanSummary;
  selected?: number | null;
  onPick?: (id: number) => void;
  comments?: Set<number>;
  flagged?: Set<number>;
}) {
  const byId = new Map(plan.teeth.map((t) => [t.id, t]));
  // Always draw the full permanent dentition (7–7); third molars only when the plan has them.
  const present = new Set([...UPPER_SEQUENCE, ...LOWER_SEQUENCE].filter((id) => toothNumber(id) !== 8 || byId.has(id)));
  const upper = layout(UPPER_SEQUENCE, present, true, 200, 164);
  const lower = layout(LOWER_SEQUENCE, present, false, 200, 214);
  const all = [...upper, ...lower];
  const pos = new Map(all.map((p) => [p.id, p]));
  const iprMap = new Map(plan.ipr.map((e) => [e.contact, e]));

  const ipr = [upper, lower].flatMap((arch, ai) =>
    arch.slice(0, -1).map((a, i) => {
      const b = arch[i + 1];
      const e = iprMap.get(contactKey(a.id, b.id));
      if (!e) return null;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const ang = (a.angle + b.angle) / 2;
      const out = 30;
      const lx = mx + Math.sin(ang) * out;
      const ly = ai === 0 ? my - Math.cos(ang) * out : my + Math.cos(ang) * out;
      return (
        <g key={e.contact} className="ipr-mark">
          <line x1={mx} y1={my} x2={lx} y2={ly} />
          <rect x={lx - 15} y={ly - 8} width={30} height={16} rx={8} />
          <text x={lx} y={ly + 4} textAnchor="middle">
            {e.amountMm.toFixed(1)}
          </text>
          <title>{`IPR ${e.contact}: ${e.amountMm.toFixed(2)} mm before aligner ${e.stage}`}</title>
        </g>
      );
    }),
  );

  return (
    <svg className="arch-chart" viewBox="0 0 400 398" role="img" aria-label="Occlusal chart of the treatment plan">
      <text x={200} y={190} textAnchor="middle" className="arch-mid">
        Patient right ← → Patient left
      </text>
      {ipr}
      {all.map((p) => {
        const t = byId.get(p.id);
        const isUpper = upper.includes(p);
        const att = t?.attachments.length ?? 0;
        const ax = p.x + Math.sin(p.angle) * (p.r + 4);
        const ay = isUpper ? p.y - Math.cos(p.angle) * (p.r + 4) : p.y + Math.cos(p.angle) * (p.r + 4);
        const tip = t
          ? [
              `${p.id} · ${shortLabel(p.id)} · ${toothName(p.id)}`,
              ...MOVEMENT_KEYS.map((k) => formatMovement(t, k)).filter(Boolean),
              att ? `${att} attachment${att > 1 ? 's' : ''}` : '',
              t.locked ? 'Fixed / anchor' : '',
              t.extracted ? 'Extracted / missing' : '',
            ]
              .filter(Boolean)
              .join('\n')
          : `${p.id} · not in plan`;
        return (
          <g
            key={p.id}
            className={`arch-tooth${selected === p.id ? ' sel' : ''}${onPick ? ' pick' : ''}${flagged?.has(p.id) ? ' flag' : ''}`}
            onClick={onPick ? () => onPick(p.id) : undefined}
            role={onPick ? 'button' : undefined}
            tabIndex={onPick ? 0 : undefined}
            onKeyDown={onPick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick(p.id)) : undefined}
            aria-label={tip.replace(/\n/g, ', ')}
          >
            <title>{tip}</title>
            <circle cx={p.x} cy={p.y} r={p.r} fill={t?.extracted || !t ? 'transparent' : color(t)} strokeDasharray={t?.locked || !t ? '3 2' : undefined} opacity={t ? 1 : 0.55} />
            {t?.extracted && <path d={`M${p.x - 6} ${p.y - 6}l12 12m0-12l-12 12`} className="x" />}
            <text x={p.x} y={p.y + 3.5} textAnchor="middle">
              {p.id}
            </text>
            {att > 0 && <rect className="att" x={ax - 3.5} y={ay - 3.5} width={7} height={7} rx={1.5} />}
            {comments?.has(p.id) && <circle className="cmt" cx={p.x + p.r * 0.75} cy={p.y - p.r * 0.75} r={4} />}
          </g>
        );
      })}
      <g className="arch-legend" transform="translate(8 393)">
        <circle cx={5} cy={-4} r={5} fill="var(--tooth)" />
        <text x={14} y={0}>No movement</text>
        <circle cx={92} cy={-4} r={5} fill="var(--move-hi)" />
        <text x={101} y={0}>More movement</text>
        <rect className="att" x={190} y={-8} width={7} height={7} rx={1.5} />
        <text x={202} y={0}>Attachment</text>
        <rect className="ipr-legend" x={262} y={-11} width={22} height={13} rx={6} />
        <text x={289} y={0}>IPR mm</text>
        {pos.size > 0 && comments && (
          <>
            <circle className="cmt" cx={340} cy={-4} r={4} />
            <text x={348} y={0}>Comment</text>
          </>
        )}
      </g>
    </svg>
  );
}
