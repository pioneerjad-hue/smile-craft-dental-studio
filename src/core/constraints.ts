import { shortLabel } from './fdi';
import type { Movement, MovementKey, Protocol, ToothPlan } from './types';
import { MOVEMENT_KEYS, MOVEMENT_META, zeroMovement } from './types';
import { totalLimitsFor } from './validate';

/**
 * Apply a tooth's constraints to a proposed movement:
 *  - locked tooth (implant, bridge, ankylosis) → no movement
 *  - locked axes → those degrees of freedom stay 0
 *  - optional hard protocol limits → values are clamped to the total-movement limits
 * Returns the constrained movement and a human-readable note for every change made.
 */
export function constrainMovement(protocol: Protocol, tp: ToothPlan, proposed: Movement): { movement: Movement; notes: string[] } {
  const notes: string[] = [];
  const id = tp.id;
  if (tp.locked) {
    const moved = MOVEMENT_KEYS.some((k) => Math.abs(proposed[k]) > 1e-9);
    if (moved) notes.push(`${shortLabel(id)} (${id}) is locked — movement ignored.`);
    return { movement: zeroMovement(), notes };
  }
  const m = { ...proposed };
  for (const k of tp.lockedAxes ?? []) {
    if (Math.abs(m[k]) > 1e-9) notes.push(`${shortLabel(id)} (${id}): ${MOVEMENT_META[k].label} is locked — kept at 0.`);
    m[k] = 0;
  }
  if (protocol.constraints?.enforceTotalLimits) {
    const lim = totalLimitsFor(protocol, id);
    const clamp = (k: MovementKey, lo: number, hi: number) => {
      const v = Math.min(hi, Math.max(lo, m[k]));
      if (Math.abs(v - m[k]) > 1e-9) notes.push(`${shortLabel(id)} (${id}): ${MOVEMENT_META[k].label} clamped to ${v.toFixed(2)}${MOVEMENT_META[k].unit} (protocol limit).`);
      m[k] = v;
    };
    clamp('extrusion', -lim.intrusionMm, lim.extrusionMm);
    clamp('tip', -lim.tipDeg, lim.tipDeg);
    clamp('torque', -lim.torqueDeg, lim.torqueDeg);
    clamp('rotation', -lim.rotationDeg, lim.rotationDeg);
    const t = Math.hypot(m.mesial, m.buccal);
    if (t > lim.translationMm + 1e-9) {
      const s = lim.translationMm / t;
      m.mesial *= s;
      m.buccal *= s;
      notes.push(`${shortLabel(id)} (${id}): translation scaled to ${lim.translationMm.toFixed(2)} mm (protocol limit).`);
    }
  }
  return { movement: m, notes };
}
