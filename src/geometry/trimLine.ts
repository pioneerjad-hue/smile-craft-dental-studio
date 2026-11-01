import { Vector3 } from 'three';
import type { ArchModel } from './archModel';

/**
 * Geodesic distance (mm, measured on the initial scan) from every gingiva vertex to the nearest tooth,
 * by Dijkstra over the gum surface. Tooth vertices are 0. Used to place aligner trim lines.
 */
export function gumDistanceToTeeth(model: ArchModel, maxMm = 6): Float32Array {
  const n = model.vertexCount;
  // 64-bit while solving: storing 32-bit values could round up and re-queue vertices forever
  const dist = new Float64Array(n).fill(Infinity);
  const P = model.base;
  // simple binary heap
  const hk: number[] = [];
  const hv: number[] = [];
  const push = (k: number, v: number) => {
    let i = hk.length;
    hk.push(k);
    hv.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= hk[i]) break;
      [hk[p], hk[i]] = [hk[i], hk[p]];
      [hv[p], hv[i]] = [hv[i], hv[p]];
      i = p;
    }
  };
  const pop = () => {
    const k = hk[0], v = hv[0];
    const lk = hk.pop()!, lv = hv.pop()!;
    if (hk.length) {
      hk[0] = lk;
      hv[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < hk.length && hk[l] < hk[m]) m = l;
        if (r < hk.length && hk[r] < hk[m]) m = r;
        if (m === i) break;
        [hk[m], hk[i]] = [hk[i], hk[m]];
        [hv[m], hv[i]] = [hv[i], hv[m]];
        i = m;
      }
    }
    return [k, v];
  };
  for (let i = 0; i < n; i++) {
    if (model.labels[i]) {
      dist[i] = 0;
      push(0, i);
    }
  }
  while (hk.length) {
    const [d, i] = pop();
    if (d > dist[i] || d > maxMm) continue;
    for (let j = model.adjOffsets[i]; j < model.adjOffsets[i + 1]; j++) {
      const g = model.adj[j];
      if (model.labels[g]) continue;
      const nd = d + Math.hypot(P[3 * g] - P[3 * i], P[3 * g + 1] - P[3 * i + 1], P[3 * g + 2] - P[3 * i + 2]);
      if (nd < dist[g]) {
        dist[g] = nd;
        push(nd, g);
      }
    }
  }
  return Float32Array.from(dist);
}

/**
 * Scalloped trim line: the iso-line `offsetMm` from the teeth across the gingiva, evaluated on the
 * stage's deformed positions so it follows the gum. Returns the longest polyline (the line around the
 * whole arch), lightly smoothed.
 */
export function trimLine(model: ArchModel, dist: Float32Array, positions: ArrayLike<number>, offsetMm: number): Vector3[] {
  const n = model.vertexCount;
  const idx = model.index;
  const f = (v: number) => (dist[v] === Infinity ? 1e6 : dist[v] - offsetMm);
  const ekey = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  const pointOn = new Map<number, Vector3>();
  const segs: [number, number][] = [];
  const edgePoint = (a: number, b: number) => {
    const k = ekey(a, b);
    if (!pointOn.has(k)) {
      const fa = f(a), fb = f(b);
      const t = fa / (fa - fb);
      pointOn.set(
        k,
        new Vector3(
          positions[3 * a] + t * (positions[3 * b] - positions[3 * a]),
          positions[3 * a + 1] + t * (positions[3 * b + 1] - positions[3 * a + 1]),
          positions[3 * a + 2] + t * (positions[3 * b + 2] - positions[3 * a + 2]),
        ),
      );
    }
    return k;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    const s = v.map((x) => f(x) >= 0);
    if (s[0] === s[1] && s[1] === s[2]) continue;
    const cross: number[] = [];
    for (let k = 0; k < 3; k++) if (s[k] !== s[(k + 1) % 3]) cross.push(edgePoint(v[k], v[(k + 1) % 3]));
    if (cross.length === 2) segs.push([cross[0], cross[1]]);
  }
  // chain segments into polylines through shared edge points
  const nbrs = new Map<number, number[]>();
  for (const [a, b] of segs) {
    (nbrs.get(a) ?? nbrs.set(a, []).get(a)!).push(b);
    (nbrs.get(b) ?? nbrs.set(b, []).get(b)!).push(a);
  }
  const used = new Set<number>();
  let best: number[] = [];
  for (const start of nbrs.keys()) {
    if (used.has(start)) continue;
    const chain = [start];
    used.add(start);
    let cur = start;
    for (;;) {
      const next = (nbrs.get(cur) ?? []).find((x) => !used.has(x));
      if (next === undefined) break;
      used.add(next);
      chain.push(next);
      cur = next;
    }
    if (chain.length > best.length) best = chain;
  }
  let pts = best.map((k) => pointOn.get(k)!.clone());
  // smoothing (moving average), keeps the loop closed if it is closed
  const closed = pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1.5;
  for (let pass = 0; pass < 3; pass++) {
    pts = pts.map((p, i) => {
      if (!closed && (i === 0 || i === pts.length - 1)) return p;
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
      return p.clone().multiplyScalar(0.5).addScaledVector(a, 0.25).addScaledVector(b, 0.25);
    });
  }
  if (closed) pts.push(pts[0].clone());
  return pts;
}

/** Trim line as a .pts text file (one "x y z" per line, mm). */
export function toPts(points: Vector3[]): string {
  return points.map((p) => `${p.x.toFixed(4)} ${p.y.toFixed(4)} ${p.z.toFixed(4)}`).join('\n') + '\n';
}
