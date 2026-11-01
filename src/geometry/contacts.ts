import { BufferGeometry, Matrix4, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { ArchModel } from './archModel';

/**
 * Per-tooth crown meshes (initial position) with BVHs, used for interproximal contact measurement and
 * attachment placement. Margin vertices (bordering gingiva) are flagged and excluded from contacts.
 */
export class ToothBody {
  readonly id: number;
  readonly geometry: BufferGeometry;
  readonly bvh: MeshBVH;
  readonly margin: Uint8Array;
  readonly positions: Float32Array;
  readonly centroid: Vector3;

  constructor(model: ArchModel, id: number) {
    this.id = id;
    this.geometry = model.toothGeometry(id);
    this.positions = this.geometry.getAttribute('position').array as Float32Array;
    this.bvh = new MeshBVH(this.geometry);
    // Margin flags: map each sub-vertex back to the arch vertex through position equality.
    const sub = new Map<string, number>();
    for (let i = 0; i < this.positions.length / 3; i++) {
      sub.set(`${this.positions[3 * i]},${this.positions[3 * i + 1]},${this.positions[3 * i + 2]}`, i);
    }
    this.margin = new Uint8Array(this.positions.length / 3);
    for (const v of model.toothVertices(id)) {
      let nearGum = model.boundary[v] === 1;
      for (let j = model.adjOffsets[v]; j < model.adjOffsets[v + 1] && !nearGum; j++) {
        if (model.labels[model.adj[j]] === 0) nearGum = true;
      }
      if (!nearGum) continue;
      const k = sub.get(`${model.base[3 * v]},${model.base[3 * v + 1]},${model.base[3 * v + 2]}`);
      if (k !== undefined) this.margin[k] = 1;
    }
    this.centroid = model.toothStats(id).centroid;
  }

  /**
   * Crown vertices on the side facing another tooth, restricted to the contact band (35–95 % of the
   * crown height from the margin) so papilla flaps and fused cervical areas are ignored.
   */
  facingSamples(toward: Vector3, occlusal: Vector3, max = 4000): Float32Array {
    const dir = toward.clone().sub(this.centroid);
    dir.addScaledVector(occlusal, -dir.dot(occlusal)).normalize();
    const P = this.positions;
    const n = P.length / 3;
    const proj = new Float32Array(n);
    const h = new Float32Array(n);
    let maxProj = -Infinity, minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = P[3 * i] - this.centroid.x, y = P[3 * i + 1] - this.centroid.y, z = P[3 * i + 2] - this.centroid.z;
      proj[i] = x * dir.x + y * dir.y + z * dir.z;
      h[i] = x * occlusal.x + y * occlusal.y + z * occlusal.z;
      maxProj = Math.max(maxProj, proj[i]);
      minH = Math.min(minH, h[i]);
      maxH = Math.max(maxH, h[i]);
    }
    const lo = minH + 0.35 * (maxH - minH);
    const hi = minH + 0.95 * (maxH - minH);
    const sel: number[] = [];
    for (let i = 0; i < n; i++) if (proj[i] > maxProj * 0.3 && h[i] >= lo && h[i] <= hi && !this.margin[i]) sel.push(i);
    const step = Math.max(1, Math.floor(sel.length / max));
    const out: number[] = [];
    for (let k = 0; k < sel.length; k += step) out.push(P[3 * sel[k]], P[3 * sel[k] + 1], P[3 * sel[k] + 2]);
    return new Float32Array(out);
  }
}

const MAX_DIST = 3;

/**
 * Interproximal distance between two crowns placed with transforms ta / tb (scan coordinates).
 * Both crowns are projected along the contact direction u (centroid A → centroid B, flattened onto the
 * occlusal plane). In every 0.5 mm column parallel to u that crosses both crowns, the gap is
 * (B's nearest surface − A's farthest surface). The result is the minimum over columns:
 * negative = overlap depth (collision, needs IPR/space), positive = gap. Works on open crown shells
 * and fused scan contacts, where inside/outside tests are unreliable. Capped at MAX_DIST.
 */
export function contactDistance(
  a: ToothBody,
  ta: Matrix4,
  b: ToothBody,
  tb: Matrix4,
  samplesA: Float32Array,
  samplesB: Float32Array,
  occlusal: Vector3,
  cell = 0.5,
): number {
  const ca = a.centroid.clone().applyMatrix4(ta);
  const cb = b.centroid.clone().applyMatrix4(tb);
  const u = cb.sub(ca);
  u.addScaledVector(occlusal, -u.dot(occlusal));
  if (u.lengthSq() < 1e-9) return MAX_DIST;
  u.normalize();
  const e1 = occlusal.clone().normalize();
  const e2 = new Vector3().crossVectors(u, e1).normalize();
  const maxA = new Map<number, number>();
  const minB = new Map<number, number>();
  const p = new Vector3();
  const key = (q: Vector3) => Math.floor(q.dot(e1) / cell) * 100003 + Math.floor(q.dot(e2) / cell);
  for (let i = 0; i < samplesA.length; i += 3) {
    p.set(samplesA[i], samplesA[i + 1], samplesA[i + 2]).applyMatrix4(ta);
    const k = key(p);
    const s = p.dot(u);
    const cur = maxA.get(k);
    if (cur === undefined || s > cur) maxA.set(k, s);
  }
  for (let i = 0; i < samplesB.length; i += 3) {
    p.set(samplesB[i], samplesB[i + 1], samplesB[i + 2]).applyMatrix4(tb);
    const k = key(p);
    const s = p.dot(u);
    const cur = minB.get(k);
    if (cur === undefined || s < cur) minB.set(k, s);
  }
  let best = MAX_DIST;
  for (const [k, sa] of maxA) {
    const sb = minB.get(k);
    if (sb !== undefined) best = Math.min(best, sb - sa);
  }
  return best;
}
