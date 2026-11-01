import { BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { HitPointInfo } from 'three-mesh-bvh';
import { v3 } from '../core/transform';
import type { ToothFrame } from '../core/types';
import type { ArchModel } from './archModel';

export interface ToothFit {
  /** Rigid transform from the initial crown to its position in the reference (final) model. */
  T: Matrix4;
  /** RMS of crown-to-surface distances after fitting (mm). */
  rmsMm: number;
  /** Fraction of crown samples within 0.5 mm of the reference surface. */
  inliers: number;
}

/** Largest eigenvector of a symmetric 4×4 matrix (Jacobi). */
function maxEigen4(A: number[][]): number[] {
  const a = A.map((r) => r.slice());
  const V: number[][] = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) off += a[i][j] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [V[0][best], V[1][best], V[2][best], V[3][best]];
}

/** Best rigid transform mapping src[i] → dst[i] (Horn's quaternion method). */
export function bestRigid(src: Vector3[], dst: Vector3[]): Matrix4 {
  const cs = new Vector3(), cd = new Vector3();
  src.forEach((p) => cs.add(p));
  dst.forEach((p) => cd.add(p));
  cs.multiplyScalar(1 / src.length);
  cd.multiplyScalar(1 / dst.length);
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < src.length; i++) {
    const a = src[i].clone().sub(cs), b = dst[i].clone().sub(cd);
    Sxx += a.x * b.x; Sxy += a.x * b.y; Sxz += a.x * b.z;
    Syx += a.y * b.x; Syy += a.y * b.y; Syz += a.y * b.z;
    Szx += a.z * b.x; Szy += a.z * b.y; Szz += a.z * b.z;
  }
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const [w, x, y, z] = maxEigen4(N);
  const q = new Quaternion(x, y, z, w).normalize();
  const R = new Matrix4().makeRotationFromQuaternion(q);
  const t = cd.clone().sub(cs.clone().applyMatrix4(R));
  return R.setPosition(t);
}

/** Crown sample points (initial coordinates): the occlusal 65 % of the crown, away from the gum. */
function crownPoints(model: ArchModel, frame: ToothFrame, max = 600): Vector3[] {
  const O = v3(frame.occlusal);
  const verts = model.toothVertices(frame.id);
  const h = Array.from(verts, (v) => model.position(v).dot(O));
  const lo = Math.min(...h), hi = Math.max(...h);
  const sel = Array.from(verts).filter((_, i) => h[i] >= lo + 0.35 * (hi - lo));
  const step = Math.max(1, Math.floor(sel.length / max));
  const out: Vector3[] = [];
  for (let i = 0; i < sel.length; i += step) out.push(model.position(sel[i]));
  return out;
}

/**
 * Fit every segmented crown of the initial model onto a reference model of the same arch (e.g. the
 * final setup exported from other planning software). Both must be in the same coordinate system.
 * Coarse translation search in the tooth's frame, then trimmed ICP with a shrinking distance cut-off.
 */
export function registerSetup(model: ArchModel, frames: Record<number, ToothFrame>, reference: BufferGeometry, onProgress?: (done: number, total: number) => void): Record<number, ToothFit> {
  const bvh = new MeshBVH(reference);
  const hit: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const closest = (p: Vector3, max: number) => bvh.closestPointToPoint(p, hit, 0, max);
  const ids = model.teeth().filter((id) => frames[id]);
  const out: Record<number, ToothFit> = {};
  ids.forEach((id, n) => {
    const f = frames[id];
    const pts = crownPoints(model, f);
    if (pts.length < 20) return;
    const coarse = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 70)) === 0);
    const M = v3(f.mesial), B = v3(f.buccal), O = v3(f.occlusal);
    const c0 = v3(f.centroid);
    // 1. coarse search: rotation about the long axis (±30°) × translation (±4.5 mm M/B, ±1.5 mm O)
    let best = new Matrix4(), bestScore = Infinity;
    const p = new Vector3();
    for (const deg of [0, -15, 15, -30, 30]) {
      const R = new Matrix4().makeTranslation(c0.x, c0.y, c0.z).multiply(new Matrix4().makeRotationAxis(O, (deg * Math.PI) / 180)).multiply(new Matrix4().makeTranslation(-c0.x, -c0.y, -c0.z));
      const rotated = coarse.map((q) => q.clone().applyMatrix4(R));
      for (let a = -4.5; a <= 4.5; a += 1.5)
        for (let b = -4.5; b <= 4.5; b += 1.5)
          for (let c = -1.5; c <= 1.5; c += 1.5) {
            const shift = M.clone().multiplyScalar(a).addScaledVector(B, b).addScaledVector(O, c);
            let sc = 0;
            for (const q of rotated) {
              const r = closest(p.copy(q).add(shift), 2.5);
              sc += r ? r.distance : 2.5;
              if (sc > bestScore) break;
            }
            if (sc < bestScore) (bestScore = sc), (best = new Matrix4().makeTranslation(shift.x, shift.y, shift.z).multiply(R));
          }
    }
    // 2. trimmed ICP with a slowly shrinking cut-off, then refinement at the final cut-off
    let T = best;
    for (let it = 0; it < 120; it++) {
      const cutoff = Math.max(0.4, 2.0 - it * 0.04);
      const src: Vector3[] = [], dst: Vector3[] = [];
      for (const q of pts) {
        const x = q.clone().applyMatrix4(T);
        const r = closest(x, cutoff);
        if (r) (src.push(x), dst.push(r.point.clone()));
      }
      if (src.length < 10) break;
      const step = bestRigid(src, dst);
      T = step.clone().multiply(T);
      const moved = new Vector3().setFromMatrixPosition(step).length();
      if (moved < 2e-5 && it > 45) break;
    }
    let sq = 0, inl = 0;
    for (const q of pts) {
      const r = closest(q.clone().applyMatrix4(T), 5);
      const d = r ? r.distance : 5;
      sq += d * d;
      if (d < 0.5) inl++;
    }
    out[id] = { T, rmsMm: Math.sqrt(sq / pts.length), inliers: inl / pts.length };
    onProgress?.(n + 1, ids.length);
  });
  return out;
}
