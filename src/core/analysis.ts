import { Vector3 } from 'three';
import type { Arch } from './fdi';
import { adjacentPairs, archOf, mesialStep, sequence, sequenceIndex, toothNumber } from './fdi';
import { v3 } from './transform';
import type { ToothFrame, TreatmentPlan } from './types';

export function toothWidth(plan: TreatmentPlan, frames: Record<number, ToothFrame>, id: number): number | undefined {
  return plan.teeth[id]?.manualWidthMm ?? frames[id]?.autoWidthMm;
}

export interface BoltonResult {
  kind: 'anterior' | 'overall';
  upperSum: number;
  lowerSum: number;
  ratio: number;
  ideal: number;
  sd: number;
  /** Positive = mandibular tooth-size excess; negative = maxillary excess (mm). */
  excessMm: number;
  missing: number[];
}

const ANTERIOR_UPPER = [13, 12, 11, 21, 22, 23];
const ANTERIOR_LOWER = [43, 42, 41, 31, 32, 33];
const OVERALL_UPPER = [16, 15, 14, ...ANTERIOR_UPPER, 24, 25, 26];
const OVERALL_LOWER = [46, 45, 44, ...ANTERIOR_LOWER, 34, 35, 36];

/** Bolton tooth-size analysis (Bolton 1958: anterior 77.2 ± 1.65 %, overall 91.3 ± 1.91 %). */
export function bolton(
  plan: TreatmentPlan,
  frames: Record<number, ToothFrame>,
  kind: 'anterior' | 'overall',
): BoltonResult {
  const upper = kind === 'anterior' ? ANTERIOR_UPPER : OVERALL_UPPER;
  const lower = kind === 'anterior' ? ANTERIOR_LOWER : OVERALL_LOWER;
  const ideal = kind === 'anterior' ? 77.2 : 91.3;
  const sd = kind === 'anterior' ? 1.65 : 1.91;
  const missing: number[] = [];
  const sum = (ids: number[]) =>
    ids.reduce((acc, id) => {
      const w = toothWidth(plan, frames, id);
      if (w === undefined || plan.teeth[id]?.extracted) {
        missing.push(id);
        return acc;
      }
      return acc + w;
    }, 0);
  const upperSum = sum(upper);
  const lowerSum = sum(lower);
  const ratio = upperSum > 0 ? (lowerSum / upperSum) * 100 : 0;
  const excessMm = ratio >= ideal ? lowerSum - (upperSum * ideal) / 100 : -(upperSum - (lowerSum * 100) / ideal);
  return { kind, upperSum, lowerSum, ratio, ideal, sd, excessMm, missing };
}

export interface SpaceAnalysis {
  arch: Arch;
  /** Arch perimeter through the estimated contact points, second premolar to second premolar (mm). */
  availableMm: number;
  /** Sum of mesio-distal widths of the same teeth (mm). */
  requiredMm: number;
  /** available - required: negative = crowding, positive = spacing. */
  discrepancyMm: number;
  teeth: number[];
}

/**
 * Space analysis measured on the mesh: the arch perimeter is the polyline through the estimated
 * contact points (crown centre ± half width along the mesial axis), projected on the occlusal plane,
 * from the mesial contact of the first molar to the mesial contact of the contralateral first molar.
 */
export function spaceAnalysis(
  arch: Arch,
  plan: TreatmentPlan,
  frames: Record<number, ToothFrame>,
): SpaceAnalysis | null {
  const ids = Object.keys(frames)
    .map(Number)
    .filter((id) => archOf(id) === arch && toothNumber(id) <= 6 && !plan.teeth[id]?.extracted);
  const pairs = adjacentPairs(arch, ids);
  if (pairs.length < 2) return null;
  const normal = new Vector3();
  ids.forEach((id) => normal.add(v3(frames[id].occlusal)));
  normal.normalize();
  const project = (p: Vector3) => p.addScaledVector(normal, -p.dot(normal));
  /** Contact point of tooth a facing its neighbour b. */
  const contactPoint = (a: number, b: number) => {
    const fa = frames[a];
    const bIsMesial = Math.sign(sequenceIndex(b) - sequenceIndex(a)) === mesialStep(a);
    const wa = toothWidth(plan, frames, a) ?? 0;
    return v3(fa.centroid).addScaledVector(v3(fa.mesial), ((bIsMesial ? 1 : -1) * wa) / 2);
  };
  const pts = pairs.map(([a, b]) => project(contactPoint(a, b).add(contactPoint(b, a)).multiplyScalar(0.5)));
  let available = 0;
  for (let i = 1; i < pts.length; i++) available += pts[i].distanceTo(pts[i - 1]);
  // Teeth fully enclosed between the first and last contact (5–5 when both first molars are present).
  const ordered = sequence(arch).filter((id) => ids.includes(id));
  const measured = ordered.slice(1, -1);
  const required = measured.reduce((acc, id) => acc + (toothWidth(plan, frames, id) ?? 0), 0);
  return { arch, availableMm: available, requiredMm: required, discrepancyMm: available - required, teeth: measured };
}
