import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { boundaryLoops, fillLoop } from './modelBase';
import { pca } from './frames';

/**
 * Model preparation on raw indexed meshes (before segmentation):
 *  - remove floating fragments (scan debris)
 *  - fill small holes (scanner gaps), keeping the outer scan border open
 *  - trim the scan with a plane, cutting triangles exactly along it
 */
export interface Mesh {
  position: Float32Array;
  index: Uint32Array;
}

export function fromGeometry(g: BufferGeometry): Mesh {
  return {
    position: new Float32Array(g.getAttribute('position').array as ArrayLike<number>),
    index: new Uint32Array(g.index!.array as ArrayLike<number>),
  };
}

export function toGeometry(m: Mesh): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.position, 3));
  g.setIndex(new BufferAttribute(m.index, 1));
  return g;
}

/** Drop unused vertices and renumber. */
export function compact(position: ArrayLike<number>, index: ArrayLike<number>): Mesh {
  const remap = new Int32Array(position.length / 3).fill(-1);
  const pos: number[] = [];
  const idx = new Uint32Array(index.length);
  for (let k = 0; k < index.length; k++) {
    const v = index[k];
    if (remap[v] < 0) {
      remap[v] = pos.length / 3;
      pos.push(position[3 * v], position[3 * v + 1], position[3 * v + 2]);
    }
    idx[k] = remap[v];
  }
  return { position: new Float32Array(pos), index: idx };
}

/** Remove connected pieces smaller than `keepFraction` of the largest piece (by triangle count). */
export function removeSmallComponents(m: Mesh, keepFraction = 0.05): { mesh: Mesh; removed: number } {
  const n = m.position.length / 3;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const idx = m.index;
  for (let f = 0; f < idx.length; f += 3) {
    const a = find(idx[f]), b = find(idx[f + 1]), c = find(idx[f + 2]);
    parent[b] = a;
    parent[find(c)] = a;
  }
  const faces = new Map<number, number>();
  for (let f = 0; f < idx.length; f += 3) {
    const r = find(idx[f]);
    faces.set(r, (faces.get(r) ?? 0) + 1);
  }
  const largest = Math.max(...faces.values());
  const keep: number[] = [];
  let removed = 0;
  for (let f = 0; f < idx.length; f += 3) {
    if ((faces.get(find(idx[f])) ?? 0) >= largest * keepFraction) keep.push(idx[f], idx[f + 1], idx[f + 2]);
    else removed++;
  }
  return { mesh: compact(m.position, keep), removed };
}

/** Fill holes whose perimeter is below `maxPerimeterMm`; the longest loop (scan border) stays open. */
export function fillSmallHoles(m: Mesh, maxPerimeterMm = 20): { mesh: Mesh; filled: number } {
  const n = m.position.length / 3;
  const loops = boundaryLoops(m.index, n);
  const pos = (i: number) => new Vector3(m.position[3 * i], m.position[3 * i + 1], m.position[3 * i + 2]);
  const perimeter = (loop: number[]) => loop.reduce((s, v, k) => s + pos(v).distanceTo(pos(loop[(k + 1) % loop.length])), 0);
  const sorted = loops.map((l) => ({ l, p: perimeter(l) })).sort((a, b) => b.p - a.p);
  const extra: number[] = [];
  let filled = 0;
  for (const { l, p } of sorted.slice(1)) {
    if (p > maxPerimeterMm) continue;
    const pts = l.map(pos);
    const { vectors } = pca(pts);
    fillLoop(l, pos, vectors[2], vectors[1], extra);
    filled++;
  }
  const index = new Uint32Array(m.index.length + extra.length);
  index.set(m.index);
  index.set(extra, m.index.length);
  return { mesh: { position: m.position, index }, filled };
}

/** Keep the part of the mesh on the side of `normal` (signed distance ≥ 0), cutting triangles exactly. */
export function trimByPlane(m: Mesh, point: Vector3, normal: Vector3): Mesh {
  const n = m.position.length / 3;
  const P = m.position;
  const nn = normal.clone().normalize();
  const sd = new Float32Array(n);
  for (let i = 0; i < n; i++) sd[i] = (P[3 * i] - point.x) * nn.x + (P[3 * i + 1] - point.y) * nn.y + (P[3 * i + 2] - point.z) * nn.z;
  const pos: number[] = Array.from(P);
  const cut = new Map<number, number>();
  const edgeVertex = (a: number, b: number) => {
    const key = a < b ? a * n + b : b * n + a;
    let v = cut.get(key);
    if (v === undefined) {
      const t = sd[a] / (sd[a] - sd[b]);
      v = pos.length / 3;
      pos.push(P[3 * a] + t * (P[3 * b] - P[3 * a]), P[3 * a + 1] + t * (P[3 * b + 1] - P[3 * a + 1]), P[3 * a + 2] + t * (P[3 * b + 2] - P[3 * a + 2]));
      cut.set(key, v);
    }
    return v;
  };
  const out: number[] = [];
  const idx = m.index;
  for (let f = 0; f < idx.length; f += 3) {
    const tri = [idx[f], idx[f + 1], idx[f + 2]];
    const inside = tri.map((v) => sd[v] >= 0);
    const count = inside.filter(Boolean).length;
    if (count === 3) {
      out.push(...tri);
      continue;
    }
    if (count === 0) continue;
    // Sutherland–Hodgman clip of the triangle, preserving winding
    const poly: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      if (inside[k]) poly.push(a);
      if (inside[k] !== inside[(k + 1) % 3]) poly.push(edgeVertex(a, b));
    }
    for (let k = 1; k + 1 < poly.length; k++) out.push(poly[0], poly[k], poly[k + 1]);
  }
  return compact(pos, out);
}
