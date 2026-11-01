import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Arch } from '../core/fdi';

/**
 * One scanned arch. The mesh topology is never cut: each vertex carries a tooth label (FDI number,
 * 0 = gingiva). Staged models are produced by moving tooth vertices rigidly and blending nearby
 * gingiva vertices, so every exported stage keeps the original scan's watertightness.
 */
export class ArchModel {
  readonly arch: Arch;
  readonly geometry: BufferGeometry;
  readonly base: Float32Array;
  readonly index: Uint32Array;
  readonly vertexCount: number;
  readonly faceCount: number;
  readonly normals: Float32Array;
  readonly adjOffsets: Uint32Array;
  readonly adj: Uint32Array;
  readonly boundary: Uint8Array;
  readonly curvature: Float32Array;
  readonly meanEdge: number;
  labels: Uint8Array;

  private toothVertexCache = new Map<number, Uint32Array>();
  private gingiva: { vtx: Uint32Array; tooth: Uint8Array; w: Float32Array } | null = null;
  gingivaRadiusMm = 4;

  constructor(arch: Arch, source: BufferGeometry) {
    this.arch = arch;
    const g = source.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    const merged = g.index ? g : mergeVertices(g, 1e-4);
    this.geometry = merged;
    const pos = merged.getAttribute('position') as BufferAttribute;
    this.vertexCount = pos.count;
    this.base = new Float32Array(pos.array as ArrayLike<number>);
    if (!(pos.array instanceof Float32Array)) {
      merged.setAttribute('position', new BufferAttribute(new Float32Array(this.base), 3));
    }
    this.index = new Uint32Array(merged.index!.array as ArrayLike<number>);
    merged.setIndex(new BufferAttribute(this.index, 1));
    this.faceCount = this.index.length / 3;
    this.labels = new Uint8Array(this.vertexCount);
    merged.computeVertexNormals();
    this.normals = new Float32Array(merged.getAttribute('normal').array as ArrayLike<number>);

    // Vertex adjacency (CSR) and open-boundary detection.
    const deg = new Uint32Array(this.vertexCount);
    const idx = this.index;
    for (let f = 0; f < idx.length; f += 3) {
      deg[idx[f]] += 2;
      deg[idx[f + 1]] += 2;
      deg[idx[f + 2]] += 2;
    }
    this.adjOffsets = new Uint32Array(this.vertexCount + 1);
    for (let i = 0; i < this.vertexCount; i++) this.adjOffsets[i + 1] = this.adjOffsets[i] + deg[i];
    this.adj = new Uint32Array(this.adjOffsets[this.vertexCount]);
    const fill = new Uint32Array(this.vertexCount);
    const push = (a: number, b: number) => {
      this.adj[this.adjOffsets[a] + fill[a]++] = b;
    };
    const edgeCount = new Map<number, number>();
    const n = this.vertexCount;
    let edgeSum = 0;
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f];
      const b = idx[f + 1];
      const c = idx[f + 2];
      push(a, b), push(a, c), push(b, a), push(b, c), push(c, a), push(c, b);
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const key = u < v ? u * n + v : v * n + u;
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      }
      edgeSum += this.dist(a, b);
    }
    this.meanEdge = edgeSum / Math.max(1, this.faceCount);
    this.boundary = new Uint8Array(n);
    for (const [key, count] of edgeCount) {
      if (count === 1) {
        this.boundary[Math.floor(key / n)] = 1;
        this.boundary[key % n] = 1;
      }
    }
    this.curvature = this.computeCurvature();
  }

  private meanEdgeEstimate(): number {
    let sum = 0, n = 0;
    for (let f = 0; f < this.index.length && n < 20000; f += 3, n++) sum += this.dist(this.index[f], this.index[f + 1]);
    return n ? sum / n : 0.2;
  }

  private dist(a: number, b: number): number {
    const p = this.base;
    return Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]);
  }

  /**
   * Signed mean-curvature estimate per vertex (1/mm): positive = concave (valleys such as the
   * gingival margin, interproximal embrasures and fissures), negative = convex.
   */
  private computeCurvature(): Float32Array {
    const n = this.vertexCount;
    const p = this.base;
    const nr = this.normals;
    let k = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (this.boundary[i]) continue;
      const s = this.adjOffsets[i];
      const e = this.adjOffsets[i + 1];
      if (e === s) continue;
      let mx = 0, my = 0, mz = 0, l2 = 0;
      for (let j = s; j < e; j++) {
        const v = this.adj[j];
        const dx = p[3 * v] - p[3 * i], dy = p[3 * v + 1] - p[3 * i + 1], dz = p[3 * v + 2] - p[3 * i + 2];
        mx += dx; my += dy; mz += dz;
        l2 += dx * dx + dy * dy + dz * dz;
      }
      const cnt = e - s;
      const d = (mx * nr[3 * i] + my * nr[3 * i + 1] + mz * nr[3 * i + 2]) / cnt;
      k[i] = (2 * d) / (l2 / cnt);
    }
    // Smooth to a fixed physical scale (~0.45 mm) so fine, noisy scanner meshes behave like coarse
    // ones: the number of smoothing passes grows with mesh density.
    const passes = Math.min(30, Math.max(2, Math.round((0.4 / Math.max(1e-3, this.meanEdgeEstimate())) ** 2)));
    for (let it = 0; it < passes; it++) {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const s = this.adjOffsets[i];
        const e = this.adjOffsets[i + 1];
        let sum = k[i];
        for (let j = s; j < e; j++) sum += k[this.adj[j]];
        out[i] = sum / (e - s + 1);
      }
      k = out;
    }
    return k;
  }

  /**
   * Rigidly re-orient the scan (used by model orientation). Labels, seeds, curvature and topology
   * are unaffected by a rigid transform.
   */
  applyMatrix(m: Matrix4): void {
    const v = new Vector3();
    for (let i = 0; i < this.vertexCount; i++) {
      v.fromArray(this.base, 3 * i).applyMatrix4(m);
      this.base[3 * i] = v.x;
      this.base[3 * i + 1] = v.y;
      this.base[3 * i + 2] = v.z;
    }
    const rot = new Matrix4().extractRotation(m);
    for (let i = 0; i < this.vertexCount; i++) {
      v.fromArray(this.normals, 3 * i).applyMatrix4(rot);
      this.normals[3 * i] = v.x;
      this.normals[3 * i + 1] = v.y;
      this.normals[3 * i + 2] = v.z;
    }
    const attr = this.geometry.getAttribute('position') as BufferAttribute;
    (attr.array as Float32Array).set(this.base);
    attr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
    this.invalidate();
  }

  position(i: number, out = new Vector3()): Vector3 {
    return out.fromArray(this.base, 3 * i);
  }

  /** Nearest vertex of a face to a point (used to turn a raycast hit into a seed vertex). */
  nearestVertexOfFace(face: number, point: Vector3): number {
    let best = this.index[3 * face];
    let bd = Infinity;
    const v = new Vector3();
    for (let k = 0; k < 3; k++) {
      const vi = this.index[3 * face + k];
      const d = this.position(vi, v).distanceToSquared(point);
      if (d < bd) {
        bd = d;
        best = vi;
      }
    }
    return best;
  }

  /** Click seeds placed by the clinician (one or more per tooth). */
  seeds: { v: number; tooth: number }[] = [];
  /** Brush strokes: 255 = none, 0 = forced gingiva, n = forced tooth n. */
  paint: Uint8Array = new Uint8Array(0);

  private ensurePaint() {
    if (this.paint.length !== this.vertexCount) this.paint = new Uint8Array(this.vertexCount).fill(255);
  }

  /**
   * Add a click seed. The seed snaps to the most convex vertex within ~1.5 mm so that a click that
   * lands in a fissure or groove still floods the whole crown.
   */
  addSeed(v: number, tooth: number, snapMm = 1.5): number {
    const best = this.snapToConvex(v, snapMm);
    this.seeds.push({ v: best, tooth });
    return best;
  }

  private snapToConvex(v: number, radiusMm: number): number {
    const center = this.position(v);
    const near = this.brushVertices(v, center, radiusMm);
    let best = v;
    for (const i of near) if (this.curvature[i] < this.curvature[best]) best = i;
    return best;
  }

  /** Brush: force vertices to a tooth (or gingiva with 0). */
  paintVertices(verts: number[], value: number): void {
    this.ensurePaint();
    for (const v of verts) this.paint[v] = value;
  }

  removeToothSeeds(tooth: number): void {
    this.seeds = this.seeds.filter((s) => s.tooth !== tooth);
    this.ensurePaint();
    for (let i = 0; i < this.vertexCount; i++) if (this.paint[i] === tooth) this.paint[i] = 255;
  }

  /**
   * Competitive watershed segmentation. Every tooth seed and the gingiva (scan border, vertices out of
   * reach of any tooth seed, and brushed gingiva) flood the surface in order of concavity; regions meet
   * along the deepest valleys: gingival margins and interproximal embrasures. Enclosed fissures belong to
   * the tooth that surrounds them. Brush strokes are hard constraints.
   * `tightness` (1/mm) raises the cost for teeth to cross a valley: positive = tighter crowns (less
   * papilla leakage), negative = crowns grow further toward the gum.
   */
  segment(radiusFor: (tooth: number) => number, tightness = 0, crown?: { up: Vector3; limitFor: (tooth: number) => number }): void {
    this.ensurePaint();
    const n = this.vertexCount;
    const out = new Int16Array(n).fill(-1);
    const elev = this.curvature;
    // Crown-height limit: a tooth may not flood further below its highest seed than a crown can be
    // tall. This stops crowns leaking into the gingiva where the margin is shallow.
    const height = crown ? new Float32Array(n) : null;
    const top = new Map<number, number>();
    if (crown && height) {
      for (let i = 0; i < n; i++) height[i] = this.base[3 * i] * crown.up.x + this.base[3 * i + 1] * crown.up.y + this.base[3 * i + 2] * crown.up.z;
      for (const sd of this.seeds) if (sd.v < n) top.set(sd.tooth, Math.max(top.get(sd.tooth) ?? -Infinity, height[sd.v]));
    }
    const penalty = (v: number, label: number) => {
      if (label === 0 || !height || !crown) return 0;
      const depth = (top.get(label) ?? height[v]) - height[v] - crown.limitFor(label);
      return depth > 0 ? 3 * Math.min(1, depth / 1.5) : 0;
    };
    const heap = new MinHeap(n * 2);
    const p = this.base;
    const seeds = this.seeds.filter((s) => s.v < n);
    // Gingiva seeds: border, out-of-reach vertices.
    for (let i = 0; i < n; i++) {
      if (this.paint[i] !== 255) {
        out[i] = this.paint[i];
        continue;
      }
      let reachable = false;
      for (const s of seeds) {
        const r = radiusFor(s.tooth);
        const dx = p[3 * i] - p[3 * s.v], dy = p[3 * i + 1] - p[3 * s.v + 1], dz = p[3 * i + 2] - p[3 * s.v + 2];
        if (dx * dx + dy * dy + dz * dz <= r * r) {
          reachable = true;
          break;
        }
      }
      if (!reachable || this.boundary[i]) out[i] = 0;
    }
    for (const s of seeds) if (this.paint[s.v] === 255) out[s.v] = s.tooth;
    for (let i = 0; i < n; i++) {
      if (out[i] < 0) continue;
      for (let j = this.adjOffsets[i]; j < this.adjOffsets[i + 1]; j++) {
        const v = this.adj[j];
        if (out[v] < 0) heap.push(elev[v] + (out[i] === 0 ? 0 : tightness) + penalty(v, out[i]), v, out[i]);
      }
    }
    while (heap.size) {
      const { key, v, label } = heap.pop();
      if (out[v] >= 0) continue;
      out[v] = label;
      for (let j = this.adjOffsets[v]; j < this.adjOffsets[v + 1]; j++) {
        const nb = this.adj[j];
        if (out[nb] < 0) heap.push(Math.max(key, elev[nb] + (label === 0 ? 0 : tightness) + penalty(nb, label)), nb, label);
      }
    }
    for (let i = 0; i < n; i++) this.labels[i] = out[i] < 0 ? 0 : out[i];
    this.invalidate();
  }

  /** Vertices within a radius of a point, connected to the seed vertex over the surface. */
  brushVertices(seed: number, center: Vector3, radiusMm: number): number[] {
    const r2 = radiusMm * radiusMm;
    const out: number[] = [];
    const seen = new Set<number>([seed]);
    const stack = [seed];
    const v = new Vector3();
    while (stack.length) {
      const i = stack.pop()!;
      if (this.position(i, v).distanceToSquared(center) > r2) continue;
      out.push(i);
      for (let j = this.adjOffsets[i]; j < this.adjOffsets[i + 1]; j++) {
        const nb = this.adj[j];
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    return out;
  }

  invalidate(): void {
    this.toothVertexCache.clear();
    this.gingiva = null;
  }

  teeth(): number[] {
    const seen = new Set<number>();
    for (let i = 0; i < this.vertexCount; i++) if (this.labels[i]) seen.add(this.labels[i]);
    return [...seen];
  }

  toothVertices(toothId: number): Uint32Array {
    let cached = this.toothVertexCache.get(toothId);
    if (!cached) {
      const list: number[] = [];
      for (let i = 0; i < this.vertexCount; i++) if (this.labels[i] === toothId) list.push(i);
      cached = new Uint32Array(list);
      this.toothVertexCache.set(toothId, cached);
    }
    return cached;
  }

  /** Faces whose three vertices belong to the tooth. */
  toothFaces(toothId: number): number[] {
    const out: number[] = [];
    const L = this.labels;
    const idx = this.index;
    for (let f = 0; f < this.faceCount; f++) {
      if (L[idx[3 * f]] === toothId && L[idx[3 * f + 1]] === toothId && L[idx[3 * f + 2]] === toothId) out.push(f);
    }
    return out;
  }

  /** Stand-alone crown geometry (initial position) for collision and attachment placement. */
  toothGeometry(toothId: number): BufferGeometry {
    const faces = this.toothFaces(toothId);
    const remap = new Map<number, number>();
    const pos: number[] = [];
    const index: number[] = [];
    for (const f of faces) {
      for (let k = 0; k < 3; k++) {
        const v = this.index[3 * f + k];
        let m = remap.get(v);
        if (m === undefined) {
          m = remap.size;
          remap.set(v, m);
          pos.push(this.base[3 * v], this.base[3 * v + 1], this.base[3 * v + 2]);
        }
        index.push(m);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }

  /** Area-weighted crown centroid and sample points. */
  toothStats(toothId: number) {
    const faces = this.toothFaces(toothId);
    const c = new Vector3();
    let area = 0;
    const a = new Vector3(), b = new Vector3(), d = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
    for (const f of faces) {
      this.position(this.index[3 * f], a);
      this.position(this.index[3 * f + 1], b);
      this.position(this.index[3 * f + 2], d);
      const ar = e1.subVectors(b, a).cross(e2.subVectors(d, a)).length() / 2;
      c.addScaledVector(a.add(b).add(d), ar / 3);
      area += ar;
    }
    const verts = this.toothVertices(toothId);
    if (area > 0) c.multiplyScalar(1 / area);
    else if (verts.length) {
      for (const v of verts) c.add(this.position(v, a));
      c.multiplyScalar(1 / verts.length);
    }
    return { centroid: c, area, vertices: verts };
  }

  /** Precompute gingiva blending weights near every tooth's margin. */
  private ensureGingivaWeights(): void {
    if (this.gingiva) return;
    const n = this.vertexCount;
    const R = this.gingivaRadiusMm;
    const L = this.labels;
    const p = this.base;
    const dist = new Float32Array(n).fill(Infinity);
    const src = new Int32Array(n).fill(-1);
    const entries: { v: number; t: number; w: number }[] = [];
    const sumW = new Float32Array(n);
    const settled = new Uint8Array(n);
    const heap = new MinHeap(1024);
    for (const t of this.teeth()) {
      // Dijkstra over gingiva vertices; key = Euclidean distance to the nearest margin vertex of
      // tooth t reached through the gum surface (each vertex settled once).
      const touched: number[] = [];
      for (const v of this.toothVertices(t)) {
        for (let j = this.adjOffsets[v]; j < this.adjOffsets[v + 1]; j++) {
          const g = this.adj[j];
          if (L[g] !== 0) continue;
          const d = Math.hypot(p[3 * g] - p[3 * v], p[3 * g + 1] - p[3 * v + 1], p[3 * g + 2] - p[3 * v + 2]);
          if (d < dist[g]) {
            if (dist[g] === Infinity) touched.push(g);
            dist[g] = d;
            src[g] = v;
            heap.push(d, g, 0);
          }
        }
      }
      while (heap.size) {
        const { key, v: i } = heap.pop();
        if (settled[i] || key > dist[i] + 1e-9) continue;
        settled[i] = 1;
        const s0 = src[i];
        for (let j = this.adjOffsets[i]; j < this.adjOffsets[i + 1]; j++) {
          const g = this.adj[j];
          if (L[g] !== 0 || settled[g]) continue;
          const d = Math.hypot(p[3 * g] - p[3 * s0], p[3 * g + 1] - p[3 * s0 + 1], p[3 * g + 2] - p[3 * s0 + 2]);
          if (d < R && d < dist[g]) {
            if (dist[g] === Infinity) touched.push(g);
            dist[g] = d;
            src[g] = s0;
            heap.push(d, g, 0);
          }
        }
      }
      for (const g of touched) {
        const x = Math.min(1, dist[g] / R);
        const w = (1 - x) * (1 - x) * (1 + 2 * x); // smooth falloff, 1 at the margin, 0 at R
        if (w > 1e-4) {
          entries.push({ v: g, t, w });
          sumW[g] += w;
        }
        dist[g] = Infinity;
        src[g] = -1;
        settled[g] = 0;
      }
    }
    // Harmonic refinement: solve Laplace's equation over the gum region (SOR iterations), with
    // weight 1 on the tooth's own margin, 0 on other teeth, outside the region and on the scan border.
    // The gum then deforms like an elastic membrane: smooth papillae between moving teeth and no
    // ridge where the falloff ends. The distance-based weights are the starting guess.
    const slots = 3;
    const regionIndex = new Int32Array(n).fill(-1);
    const regionVerts: number[] = [];
    for (const e of entries) {
      if (regionIndex[e.v] < 0) {
        regionIndex[e.v] = regionVerts.length;
        regionVerts.push(e.v);
      }
    }
    const RV = regionVerts.length;
    const slotTooth = new Uint8Array(RV * slots);
    const slotW = new Float32Array(RV * slots);
    for (const e of entries) {
      const base = regionIndex[e.v] * slots;
      let k = 0;
      while (k < slots && slotTooth[base + k] !== 0 && slotTooth[base + k] !== e.t) k++;
      if (k === slots) {
        // keep the strongest three teeth
        let weakest = 0;
        for (let q = 1; q < slots; q++) if (slotW[base + q] < slotW[base + weakest]) weakest = q;
        if (slotW[base + weakest] >= e.w) continue;
        k = weakest;
      }
      slotTooth[base + k] = e.t;
      slotW[base + k] = sumW[e.v] > 1 ? e.w / sumW[e.v] : e.w;
    }
    const valueAt = (nb: number, t: number) => {
      const l = L[nb];
      if (l !== 0) return l === t ? 1 : 0;
      const r = regionIndex[nb];
      if (r < 0) return 0;
      const base = r * slots;
      for (let q = 0; q < slots; q++) if (slotTooth[base + q] === t) return slotW[base + q];
      return 0;
    };
    const omega = 1.7;
    const maxIter = Math.min(250, Math.max(40, Math.round((3 * R_MM_FACTOR * this.gingivaRadiusMm) / Math.max(0.05, this.meanEdge))));
    for (let it = 0; it < maxIter; it++) {
      let maxDelta = 0;
      for (let r = 0; r < RV; r++) {
        const v = regionVerts[r];
        const base = r * slots;
        if (this.boundary[v]) {
          for (let q = 0; q < slots; q++) slotW[base + q] = 0;
          continue;
        }
        const s0 = this.adjOffsets[v], s1 = this.adjOffsets[v + 1];
        const deg = s1 - s0;
        for (let q = 0; q < slots; q++) {
          const t = slotTooth[base + q];
          if (!t) continue;
          let acc = 0;
          for (let j = s0; j < s1; j++) acc += valueAt(this.adj[j], t);
          const old = slotW[base + q];
          const next = Math.min(1, Math.max(0, old + omega * (acc / deg - old)));
          slotW[base + q] = next;
          maxDelta = Math.max(maxDelta, Math.abs(next - old));
        }
      }
      if (maxDelta < 2e-4) break;
    }
    // Ease the ends: gum right at the margin follows the tooth almost rigidly, and the deformation
    // fades out with zero slope at the edge of the region.
    const outV: number[] = [], outT: number[] = [], outW: number[] = [];
    for (let r = 0; r < RV; r++) {
      for (let q = 0; q < slots; q++) {
        const t = slotTooth[r * slots + q];
        const w0 = slotW[r * slots + q];
        if (!t || w0 < 1e-4) continue;
        outV.push(regionVerts[r]);
        outT.push(t);
        outW.push(w0 * w0 * (3 - 2 * w0));
      }
    }
    const vtx = new Uint32Array(outV);
    const tooth = new Uint8Array(outT);
    const w = new Float32Array(outW);
    this.gingiva = { vtx, tooth, w };
  }

  /** Compute deformed vertex positions for a set of rigid tooth transforms. */
  deformedPositions(transforms: Map<number, Matrix4>, out?: Float32Array, flatten?: Map<number, { point: Vector3; normal: Vector3 }>): Float32Array {
    const pos = out ?? new Float32Array(this.base.length);
    pos.set(this.base);
    // Extracted teeth collapse onto a plane at their cervical level: a flat gum patch that keeps the
    // mesh closed.
    if (flatten) {
      for (const [t, { point, normal }] of flatten) {
        for (const i of this.toothVertices(t)) {
          const d = (pos[3 * i] - point.x) * normal.x + (pos[3 * i + 1] - point.y) * normal.y + (pos[3 * i + 2] - point.z) * normal.z;
          pos[3 * i] -= d * normal.x;
          pos[3 * i + 1] -= d * normal.y;
          pos[3 * i + 2] -= d * normal.z;
        }
      }
    }
    if (transforms.size === 0) return pos;
    this.ensureGingivaWeights();
    const v = new Vector3();
    for (const [t, m] of transforms) {
      for (const i of this.toothVertices(t)) {
        v.fromArray(this.base, 3 * i).applyMatrix4(m);
        pos[3 * i] = v.x;
        pos[3 * i + 1] = v.y;
        pos[3 * i + 2] = v.z;
      }
    }
    const g = this.gingiva!;
    for (let k = 0; k < g.vtx.length; k++) {
      const m = transforms.get(g.tooth[k]);
      if (!m) continue;
      const i = g.vtx[k];
      v.fromArray(this.base, 3 * i).applyMatrix4(m);
      pos[3 * i] += g.w[k] * (v.x - this.base[3 * i]);
      pos[3 * i + 1] += g.w[k] * (v.y - this.base[3 * i + 1]);
      pos[3 * i + 2] += g.w[k] * (v.z - this.base[3 * i + 2]);
    }
    return pos;
  }

  /** Apply transforms to the live geometry. */
  deform(transforms: Map<number, Matrix4>, flatten?: Map<number, { point: Vector3; normal: Vector3 }>): void {
    const attr = this.geometry.getAttribute('position') as BufferAttribute;
    this.deformedPositions(transforms, attr.array as Float32Array, flatten);
    attr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }
}

/** Iteration budget factor for the harmonic gum solve (rings across the region). */
const R_MM_FACTOR = 1;

/** Binary min-heap of (key, vertex, label) used by the watershed. */
class MinHeap {
  private keys: Float64Array;
  private verts: Uint32Array;
  private labs: Int16Array;
  size = 0;
  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.verts = new Uint32Array(capacity);
    this.labs = new Int16Array(capacity);
  }
  private grow() {
    const k = new Float64Array(this.keys.length * 2); k.set(this.keys); this.keys = k;
    const v = new Uint32Array(this.verts.length * 2); v.set(this.verts); this.verts = v;
    const l = new Int16Array(this.labs.length * 2); l.set(this.labs); this.labs = l;
  }
  push(key: number, v: number, label: number) {
    if (this.size === this.keys.length) this.grow();
    let i = this.size++;
    const K = this.keys, V = this.verts, L = this.labs;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (K[parent] <= key) break;
      K[i] = K[parent]; V[i] = V[parent]; L[i] = L[parent];
      i = parent;
    }
    K[i] = key; V[i] = v; L[i] = label;
  }
  pop(): { key: number; v: number; label: number } {
    const K = this.keys, V = this.verts, L = this.labs;
    const top = { key: K[0], v: V[0], label: L[0] };
    const last = --this.size;
    if (last > 0) {
      const key = K[last], v = V[last], lab = L[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= last) break;
        const r = l + 1;
        const c = r < last && K[r] < K[l] ? r : l;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c]; L[i] = L[c];
        i = c;
      }
      K[i] = key; V[i] = v; L[i] = lab;
    }
    return top;
  }
}

/** Reach of a click seed: farthest crown point from a click on the occlusal/incisal surface (mm). */
export function seedRadiusMm(tooth: number, scale = 1): number {
  const r = [11, 10, 11.5, 9, 9, 9.5, 9.5, 9][(tooth % 10) - 1] ?? 10;
  return r * scale;
}

/** Generous maximum crown height (cusp tip / incisal edge → gingival margin, mm) by tooth. */
export function crownHeightLimitMm(tooth: number): number {
  const upper = [12, 11, 12, 10, 9.5, 9, 9, 8.5];
  const lower = [10, 10.5, 12, 10, 9.5, 9, 9, 8.5];
  return ((tooth < 30 ? upper : lower)[(tooth % 10) - 1]) ?? 11;
}
