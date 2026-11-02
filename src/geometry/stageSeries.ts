import type { BufferGeometry } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';


/**
 * A sequence of stage models of one arch (e.g. STL exported per aligner by other planning software).
 * When every stage has the same triangles in the same order (the usual case for staged exports), the
 * models share one vertex/index layout and only positions change — stored compactly and animated
 * smoothly. Otherwise each stage is kept as its own mesh.
 */
export type StageSeries =
  | { shared: true; index: Uint32Array; positions: Float32Array[] }
  | { shared: false; meshes: { index: Uint32Array; positions: Float32Array }[] };

/** Triangle-corner positions (non-indexed) of any geometry. */
function corners(g: BufferGeometry): Float32Array {
  const ng = g.index ? g.toNonIndexed() : g;
  return new Float32Array(ng.getAttribute('position').array as ArrayLike<number>);
}

export function buildStageSeries(stages: BufferGeometry[], toleranceMm = 1e-3): StageSeries {
  const raw = stages.map(corners);
  const sameCount = raw.every((r) => r.length === raw[0].length);
  if (sameCount && raw.length > 0) {
    // vertex layout from stage 0: corners at the same position become one vertex
    const nCorners = raw[0].length / 3;
    const cornerToVertex = new Uint32Array(nCorners);
    const key = new Map<string, number>();
    const r0 = raw[0];
    let vCount = 0;
    for (let c = 0; c < nCorners; c++) {
      const k = `${Math.round(r0[3 * c] * 1e5)},${Math.round(r0[3 * c + 1] * 1e5)},${Math.round(r0[3 * c + 2] * 1e5)}`;
      let v = key.get(k);
      if (v === undefined) key.set(k, (v = vCount++));
      cornerToVertex[c] = v;
    }
    const index = cornerToVertex;
    // every stage must map consistently: corners sharing a vertex keep sharing a position
    const positions: Float32Array[] = [];
    let consistent = true;
    for (const r of raw) {
      const pos = new Float32Array(vCount * 3).fill(Number.NaN);
      for (let c = 0; c < r.length / 3 && consistent; c++) {
        const v = cornerToVertex[c];
        if (Number.isNaN(pos[3 * v])) pos.set([r[3 * c], r[3 * c + 1], r[3 * c + 2]], 3 * v);
        else if (Math.abs(pos[3 * v] - r[3 * c]) > toleranceMm || Math.abs(pos[3 * v + 1] - r[3 * c + 1]) > toleranceMm || Math.abs(pos[3 * v + 2] - r[3 * c + 2]) > toleranceMm) consistent = false;
      }
      if (!consistent) break;
      positions.push(pos);
    }
    if (consistent) return { shared: true, index, positions };
  }
  return {
    shared: false,
    meshes: stages.map((g) => {
      const m = g.index ? g : mergeVertices(g, 1e-6);
      return { index: new Uint32Array(m.index!.array as ArrayLike<number>), positions: new Float32Array(m.getAttribute('position').array as ArrayLike<number>) };
    }),
  };
}

/** Consecutive stages sharing one layout, stored as one compact group (stage positions + index). */
export interface StageGroup {
  from: number;
  index: Uint32Array;
  positions: Float32Array[];
}

/**
 * Split a stage sequence into runs that share a layout (e.g. stage 0 without attachments, stages 1–N
 * with attachments). Each run is stored once with per-stage positions; the viewer swaps meshes only
 * when crossing from one run to the next.
 */
export function buildStageGroups(stages: BufferGeometry[]): StageGroup[] {
  const tri = stages.map((g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3);
  const groups: StageGroup[] = [];
  let i = 0;
  while (i < stages.length) {
    let j = i + 1;
    while (j < stages.length && tri[j] === tri[i]) j++;
    // try the whole run; if it does not share a layout, fall back to single stages
    const run = buildStageSeries(stages.slice(i, j));
    if (run.shared) groups.push({ from: i, index: run.index, positions: run.positions });
    else run.meshes.forEach((m, k) => groups.push({ from: i + k, index: m.index, positions: [m.positions] }));
    i = j;
  }
  return groups;
}
