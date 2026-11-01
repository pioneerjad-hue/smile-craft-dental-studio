import type { ArchModel } from './archModel';

export interface OcclusionMetrics {
  /** Horizontal distance from the upper incisal edge to the labial surface of the lower incisors (mm). */
  overjetMm: number;
  /** Vertical overlap of the incisors (mm): + = overlap (deep bite direction), − = open bite. */
  overbiteMm: number;
  /** Upper midline minus lower midline along patient right (mm): + = upper midline to the right. */
  midlineMm: number;
}

/**
 * Incisor relationship measured on the crown surfaces, in patient coordinates (+X right, +Y anterior,
 * +Z up — the models must be oriented). Uses the central incisors (11/21 and 31/41).
 */
export function occlusionMetrics(upper: ArchModel, upperPos: ArrayLike<number>, lower: ArchModel, lowerPos: ArrayLike<number>): OcclusionMetrics | null {
  const collect = (m: ArchModel, pos: ArrayLike<number>, ids: number[]) => {
    const out: { x: number; y: number; z: number; t: number }[] = [];
    for (let i = 0; i < m.vertexCount; i++) if (ids.includes(m.labels[i])) out.push({ x: pos[3 * i], y: pos[3 * i + 1], z: pos[3 * i + 2], t: m.labels[i] });
    return out;
  };
  const U = collect(upper, upperPos, [11, 21]);
  const L = collect(lower, lowerPos, [31, 41]);
  if (!U.some((p) => p.t === 11) || !U.some((p) => p.t === 21) || !L.some((p) => p.t === 31) || !L.some((p) => p.t === 41)) return null;
  const zU = Math.min(...U.map((p) => p.z));
  const zL = Math.max(...L.map((p) => p.z));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  // incisal edges: lowest 0.8 mm of the upper centrals, highest 0.8 mm of the lower centrals
  const uEdge = U.filter((p) => p.z <= zU + 0.8);
  const lEdge = L.filter((p) => p.z >= zL - 0.8);
  const yUpperEdge = mean(uEdge.map((p) => p.y));
  // labial-most point of the lower incisors in their incisal third
  const yLowerLabial = Math.max(...L.filter((p) => p.z >= zL - 2.5).map((p) => p.y));
  // midline = midpoint between the two centrals' incisal edges
  const mid = (pts: typeof U, a: number, b: number) => (mean(pts.filter((p) => p.t === a).map((p) => p.x)) + mean(pts.filter((p) => p.t === b).map((p) => p.x))) / 2;
  return {
    overjetMm: yUpperEdge - yLowerLabial,
    overbiteMm: zL - zU,
    midlineMm: mid(uEdge, 11, 21) - mid(lEdge, 41, 31),
  };
}
