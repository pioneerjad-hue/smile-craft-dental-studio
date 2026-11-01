import { archOf, toothType } from './fdi';
import type { Arch } from './fdi';
import { maxPointDisplacement, scaleMovement } from './transform';
import type { Movement, MovementKey, Protocol, StageLimits, ToothFrame, ToothPlan, Vec3 } from './types';
import { MOVEMENT_KEYS, isZeroMovement, zeroMovement } from './types';

export interface StagingToothInput {
  plan: ToothPlan;
  frame: ToothFrame;
  /** Points sampled on the crown surface (scan coordinates) to check real crown displacement. */
  samples: Vec3[];
}

export interface ToothStaging {
  id: number;
  start: number;
  /** Stage at which the tooth reaches its final position. */
  end: number;
  /** Number of stages this tooth needs at protocol limits. */
  stagesNeeded: number;
  limitingFactor: MovementKey | 'crownDisplacement' | null;
  /** Largest per-stage values actually used. */
  perStage: Movement;
  maxCrownStepMm: number;
}

export interface StagingResult {
  totalStages: number;
  archStages: Record<Arch, number>;
  teeth: Record<number, ToothStaging>;
  weeks: number;
}

export function limitsFor(protocol: Protocol, id: number): StageLimits {
  return { ...protocol.staging.limits, ...protocol.staging.overrides[toothType(id)] };
}

function dofLimit(limits: StageLimits, key: MovementKey, value: number): number {
  switch (key) {
    case 'mesial':
    case 'buccal':
      return limits.translationMm;
    case 'extrusion':
      return value >= 0 ? limits.extrusionMm : limits.intrusionMm;
    case 'tip':
      return limits.tipDeg;
    case 'torque':
      return limits.torqueDeg;
    case 'rotation':
      return limits.rotationDeg;
  }
}

const ceil = (x: number) => Math.max(0, Math.ceil(x - 1e-9));

/** Minimum number of stages a tooth needs so that every per-stage limit is respected. */
export function stagesNeeded(
  protocol: Protocol,
  input: StagingToothInput,
): { n: number; factor: ToothStaging['limitingFactor'] } {
  const { plan, frame, samples } = input;
  const m = plan.movement;
  if (plan.locked || plan.extracted || isZeroMovement(m)) return { n: 0, factor: null };
  const limits = limitsFor(protocol, plan.id);
  let n = 0;
  let factor: ToothStaging['limitingFactor'] = null;
  for (const k of MOVEMENT_KEYS) {
    const lim = dofLimit(limits, k, m[k]);
    const s = lim > 0 ? ceil(Math.abs(m[k]) / lim) : 0;
    if (s > n) {
      n = s;
      factor = k;
    }
  }
  if (samples.length && limits.crownDisplacementMm > 0) {
    // Increase n until the largest crown-point step between consecutive stages is within the limit.
    for (let guard = 0; guard < 50; guard++) {
      const step = maxStep(frame, m, n, samples);
      if (step <= limits.crownDisplacementMm + 1e-9) break;
      const next = Math.max(n + 1, ceil((n * step) / limits.crownDisplacementMm));
      n = next;
      factor = 'crownDisplacement';
    }
  }
  return { n, factor };
}

/** Largest crown-point displacement between consecutive stages when a movement is split in n steps. */
export function maxStep(frame: ToothFrame, m: Movement, n: number, samples: Vec3[]): number {
  if (n <= 0) return isZeroMovement(m) ? 0 : Infinity;
  let max = 0;
  let prev = zeroMovement();
  // Linear interpolation: steps are near-identical, but check them all for exactness with rotations.
  const checks = Math.min(n, 12);
  for (let j = 1; j <= checks; j++) {
    const stage = Math.round((j * n) / checks);
    const prevStage = Math.round(((j - 1) * n) / checks);
    if (stage === prevStage) continue;
    prev = scaleMovement(m, prevStage / n);
    const cur = scaleMovement(m, stage / n);
    max = Math.max(max, maxPointDisplacement(frame, prev, cur, samples) / (stage - prevStage));
  }
  return max;
}

export function computeStaging(protocol: Protocol, teeth: StagingToothInput[]): StagingResult {
  const result: StagingResult = { totalStages: 0, archStages: { upper: 0, lower: 0 }, teeth: {}, weeks: 0 };
  const needs = teeth.map((t) => ({ t, ...stagesNeeded(protocol, t) }));

  for (const { t, n } of needs) {
    if (n === 0) continue;
    const arch = archOf(t.plan.id);
    const end = Math.max(0, Math.floor(t.plan.startStage)) + n;
    result.archStages[arch] = Math.max(result.archStages[arch], end);
  }
  if (protocol.staging.syncArches) {
    const m = Math.max(result.archStages.upper, result.archStages.lower);
    result.archStages = { upper: m, lower: m };
  }
  result.totalStages = Math.max(result.archStages.upper, result.archStages.lower);

  for (const { t, n, factor } of needs) {
    const id = t.plan.id;
    const start = Math.max(0, Math.floor(t.plan.startStage));
    const archTotal = result.archStages[archOf(id)];
    const end = n === 0 ? start : protocol.staging.mode === 'synchronized' ? Math.max(archTotal, start + n) : start + n;
    const span = Math.max(1, end - start);
    const perStage = scaleMovement(t.plan.movement, n === 0 ? 0 : 1 / span);
    result.teeth[id] = {
      id,
      start,
      end,
      stagesNeeded: n,
      limitingFactor: factor,
      perStage,
      maxCrownStepMm: n === 0 ? 0 : maxStep(t.frame, t.plan.movement, span, t.samples),
    };
  }
  result.weeks = (result.totalStages * protocol.staging.daysPerStage) / 7;
  return result;
}

/** Fraction (0..1) of the total movement a tooth has completed at a given stage. */
export function stageFraction(s: ToothStaging | undefined, stage: number): number {
  if (!s || s.end <= s.start) return s && stage >= s.end && s.stagesNeeded > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, (stage - s.start) / (s.end - s.start)));
}

/** Movement of a tooth at a given stage. */
export function movementAtStage(plan: ToothPlan, s: ToothStaging | undefined, stage: number): Movement {
  if (plan.locked || plan.extracted) return zeroMovement();
  return scaleMovement(plan.movement, stageFraction(s, stage));
}
