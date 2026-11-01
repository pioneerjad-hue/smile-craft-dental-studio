import type { Arch } from '../core/fdi';
import { sequence, toothNumber } from '../core/fdi';
import type { ArchModel } from './archModel';

/** Average mesio-distal crown widths (mm) by tooth number 1–8, used only as a prior for spacing. */
export const MEAN_WIDTH: Record<Arch, number[]> = {
  upper: [8.6, 6.6, 7.6, 7.0, 6.5, 10.2, 9.0, 8.5],
  lower: [5.4, 5.9, 6.9, 7.0, 7.1, 11.0, 10.5, 10.0],
};

/**
 * Automatic seed placement for tooth segmentation on an oriented arch
 * (+X patient right, +Y anterior, +Z up).
 *  1. Fit the arch curve y = a + b·x² + c·x⁴ through the crown tops.
 *  2. Build the crown-top height profile along the arch (arc length).
 *  3. Choose tooth boundaries among the profile valleys (interproximal contacts) by dynamic
 *     programming, matching the expected widths of the teeth marked present.
 *  4. Seed each tooth at the highest crown point of its segment near the arch curve.
 * The watershed then grows every seed into a crown; any mistake is corrected by clicking.
 */
export function autoSeeds(model: ArchModel, arch: Arch, present: number[]): { tooth: number; v: number }[] {
  const teeth = sequence(arch).filter((t) => present.includes(t));
  if (!teeth.length) return [];
  const n = model.vertexCount;
  const P = model.base;
  const sign = arch === 'lower' ? 1 : -1;
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = sign * P[3 * i + 2];
  const sorted = Float32Array.from(h).sort();
  const pct = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];

  // 1. arch curve through the highest 15 % (crown tops)
  const topIdx: number[] = [];
  const hTop = pct(0.85);
  for (let i = 0; i < n; i++) if (h[i] >= hTop) topIdx.push(i);
  const coef = fitEvenQuartic(topIdx.map((i) => [P[3 * i], P[3 * i + 1]]));
  let xmin = Infinity, xmax = -Infinity;
  for (const i of topIdx) (xmin = Math.min(xmin, P[3 * i])), (xmax = Math.max(xmax, P[3 * i]));
  const curve: { x: number; y: number; s: number }[] = [];
  // walk from patient right (+x) to left (−x) so arc length follows the FDI sequence
  for (let x = xmax + 3, s = 0, prev: [number, number] | null = null; x >= xmin - 3; x -= 0.2) {
    const y = coef[0] + coef[1] * x * x + coef[2] * x ** 4;
    if (prev) s += Math.hypot(x - prev[0], y - prev[1]);
    curve.push({ x, y, s });
    prev = [x, y];
  }

  // 2. project crown-band vertices onto the curve
  const band = pct(0.55);
  const bin = 0.25;
  const nBins = Math.ceil(curve[curve.length - 1].s / bin) + 1;
  const prof = new Float32Array(nBins).fill(-Infinity);
  const near: { i: number; s: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (h[i] < band) continue;
    const x = P[3 * i], y = P[3 * i + 1];
    // coarse-to-fine nearest curve point
    let best = 0, bd = Infinity;
    for (let k = 0; k < curve.length; k += 10) {
      const d = (curve[k].x - x) ** 2 + (curve[k].y - y) ** 2;
      if (d < bd) (bd = d), (best = k);
    }
    for (let k = Math.max(0, best - 10); k < Math.min(curve.length, best + 10); k++) {
      const d = (curve[k].x - x) ** 2 + (curve[k].y - y) ** 2;
      if (d < bd) (bd = d), (best = k);
    }
    const d = Math.sqrt(bd);
    if (d > 5) continue;
    const s = curve[best].s;
    near.push({ i, s, d });
    const b = Math.floor(s / bin);
    if (h[i] > prof[b]) prof[b] = h[i];
  }
  let first = prof.findIndex((v) => v > -Infinity);
  let last = nBins - 1;
  while (last > 0 && prof[last] === -Infinity) last--;
  if (first < 0) return [];
  // fill gaps and smooth
  for (let b = first; b <= last; b++) if (prof[b] === -Infinity) prof[b] = prof[b - 1];
  const sm = new Float32Array(nBins);
  for (let b = first; b <= last; b++) {
    let acc = 0, c = 0;
    for (let k = -2; k <= 2; k++) if (b + k >= first && b + k <= last) (acc += prof[b + k]), c++;
    sm[b] = acc / c;
  }
  const sStart = first * bin, sEnd = (last + 1) * bin;

  // 3. valley candidates with prominence
  const cand: { s: number; prom: number }[] = [{ s: sStart, prom: 2 }];
  const win = Math.round(1.5 / bin);
  for (let b = first + win; b <= last - win; b++) {
    let isMin = true, leftMax = -Infinity, rightMax = -Infinity;
    for (let k = 1; k <= win; k++) {
      if (sm[b - k] < sm[b] || sm[b + k] < sm[b]) isMin = false;
      leftMax = Math.max(leftMax, sm[b - k]);
      rightMax = Math.max(rightMax, sm[b + k]);
    }
    const prom = Math.min(leftMax, rightMax) - sm[b];
    if (isMin && prom > 0.15) cand.push({ s: (b + 0.5) * bin, prom });
  }
  cand.push({ s: sEnd, prom: 2 });
  const widths = teeth.map((t) => MEAN_WIDTH[arch][toothNumber(t) - 1]);
  const scale = (sEnd - sStart) / widths.reduce((a, b) => a + b, 0);
  const expect = widths.map((w) => w * scale);
  const N = teeth.length, K = cand.length;
  let bounds: number[];
  if (K < N + 1) {
    bounds = [sStart];
    for (const w of expect) bounds.push(bounds[bounds.length - 1] + w);
  } else {
    const cost = Array.from({ length: K }, () => new Float64Array(N + 1).fill(Infinity));
    const from = Array.from({ length: K }, () => new Int32Array(N + 1).fill(-1));
    cost[0][0] = 0;
    for (let j = 1; j <= N; j++) {
      for (let k = 1; k < K; k++) {
        for (let p = 0; p < k; p++) {
          if (cost[p][j - 1] === Infinity) continue;
          const w = cand[k].s - cand[p].s;
          const e = (w - expect[j - 1]) / expect[j - 1];
          const c = cost[p][j - 1] + e * e + 0.05 / (0.2 + cand[k].prom);
          if (c < cost[k][j]) (cost[k][j] = c), (from[k][j] = p);
        }
      }
    }
    bounds = [];
    let k = K - 1;
    for (let j = N; j >= 0; j--) {
      bounds.unshift(cand[k].s);
      k = from[k][j];
      if (k < 0 && j > 0) break;
    }
    if (bounds.length !== N + 1) {
      bounds = [sStart];
      for (const w of expect) bounds.push(bounds[bounds.length - 1] + w);
    }
  }

  // 4. seed = highest crown point near the middle of each segment
  const seeds: { tooth: number; v: number }[] = [];
  teeth.forEach((tooth, j) => {
    const a = bounds[j], b = bounds[j + 1], w = b - a;
    let best = -1, bh = -Infinity;
    for (const p of near) {
      if (p.s < a + 0.25 * w || p.s > b - 0.25 * w || p.d > 3) continue;
      const score = h[p.i] - 0.3 * p.d;
      if (score > bh) (bh = score), (best = p.i);
    }
    if (best >= 0) seeds.push({ tooth, v: best });
  });
  return seeds;
}

/** Least-squares fit of y = a + b·x² + c·x⁴ (symmetric arch form). */
function fitEvenQuartic(pts: [number, number][]): [number, number, number] {
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const r = [0, 0, 0];
  for (const [x, y] of pts) {
    const f = [1, x * x, x ** 4];
    for (let i = 0; i < 3; i++) {
      r[i] += f[i] * y;
      for (let j = 0; j < 3; j++) A[i][j] += f[i] * f[j];
    }
  }
  // Gaussian elimination
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
    [A[i], A[piv]] = [A[piv], A[i]];
    [r[i], r[piv]] = [r[piv], r[i]];
    for (let k = i + 1; k < 3; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < 3; j++) A[k][j] -= f * A[i][j];
      r[k] -= f * r[i];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = r[i];
    for (let j = i + 1; j < 3; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x as [number, number, number];
}
