import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Movement, ToothFrame, Vec3 } from './types';

const DEG = Math.PI / 180;

export const v3 = (a: Vec3) => new Vector3(a[0], a[1], a[2]);
export const tuple = (v: Vector3): Vec3 => [v.x, v.y, v.z];

/** Scale a movement by a fraction (linear staging). */
export function scaleMovement(m: Movement, f: number): Movement {
  return {
    mesial: m.mesial * f,
    buccal: m.buccal * f,
    extrusion: m.extrusion * f,
    tip: m.tip * f,
    torque: m.torque * f,
    rotation: m.rotation * f,
  };
}

/**
 * Rigid transform (scan coordinates) for a tooth movement expressed in its clinical frame.
 * Rotations are about axes through the pivot (estimated centre of rotation):
 *   rotation about the occlusal axis, then tip, then torque; translation applied last.
 * Axis choices guarantee the sign conventions documented on `Movement` in every quadrant:
 *   tip axis    = O × M  (rotating O towards M  → crown tips mesially)
 *   torque axis = O × B  (rotating O towards B  → crown moves buccally)
 *   rot axis    = B × M  (rotating M towards -B → mesial surface goes lingual)
 */
export function movementMatrix(frame: ToothFrame, m: Movement, out = new Matrix4()): Matrix4 {
  const M = v3(frame.mesial);
  const B = v3(frame.buccal);
  const O = v3(frame.occlusal);
  const pivot = v3(frame.pivot);

  const qRot = new Quaternion().setFromAxisAngle(new Vector3().crossVectors(B, M).normalize(), m.rotation * DEG);
  const qTip = new Quaternion().setFromAxisAngle(new Vector3().crossVectors(O, M).normalize(), m.tip * DEG);
  const qTorque = new Quaternion().setFromAxisAngle(new Vector3().crossVectors(O, B).normalize(), m.torque * DEG);
  const q = qTorque.multiply(qTip).multiply(qRot);

  const d = new Vector3()
    .addScaledVector(M, m.mesial)
    .addScaledVector(B, m.buccal)
    .addScaledVector(O, m.extrusion);

  const toOrigin = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  const rot = new Matrix4().makeRotationFromQuaternion(q);
  const back = new Matrix4().makeTranslation(pivot.x + d.x, pivot.y + d.y, pivot.z + d.z);
  return out.copy(back).multiply(rot).multiply(toOrigin);
}

/** Largest displacement of any of the sample points between two movements. */
export function maxPointDisplacement(frame: ToothFrame, a: Movement, b: Movement, points: Vec3[]): number {
  const ma = movementMatrix(frame, a);
  const mb = movementMatrix(frame, b);
  const pa = new Vector3();
  const pb = new Vector3();
  let max = 0;
  for (const p of points) {
    pa.set(p[0], p[1], p[2]).applyMatrix4(ma);
    pb.set(p[0], p[1], p[2]).applyMatrix4(mb);
    max = Math.max(max, pa.distanceTo(pb));
  }
  return max;
}

/** Crown-centre displacement for a full movement, decomposed in the tooth frame (mm). */
export function crownDisplacement(frame: ToothFrame, m: Movement) {
  const mat = movementMatrix(frame, m);
  const c = v3(frame.centroid);
  const moved = c.clone().applyMatrix4(mat).sub(c);
  return {
    mesial: moved.dot(v3(frame.mesial)),
    buccal: moved.dot(v3(frame.buccal)),
    occlusal: moved.dot(v3(frame.occlusal)),
    total: moved.length(),
  };
}

/**
 * Inverse of `movementMatrix`: the clinical movement (in the tooth's frame, about its pivot) that
 * best reproduces a rigid transform. Angles are solved by Gauss–Newton on the rotation (exact for the
 * composition used by `movementMatrix`), then the translation follows in closed form.
 */
export function movementFromMatrix(frame: ToothFrame, T: Matrix4): Movement {
  const target = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(T));
  const M = v3(frame.mesial), B = v3(frame.buccal), O = v3(frame.occlusal);
  const axes = {
    rotation: new Vector3().crossVectors(B, M).normalize(),
    tip: new Vector3().crossVectors(O, M).normalize(),
    torque: new Vector3().crossVectors(O, B).normalize(),
  };
  const quat = (a: number[]) =>
    new Quaternion()
      .setFromAxisAngle(axes.torque, a[2])
      .multiply(new Quaternion().setFromAxisAngle(axes.tip, a[1]))
      .multiply(new Quaternion().setFromAxisAngle(axes.rotation, a[0]));
  // residual: rotation vector of (q(a)^-1 · target), signed so the shortest rotation is used
  const residual = (a: number[]) => {
    const q = quat(a).invert().multiply(target);
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const s = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z);
    const ang = 2 * Math.atan2(s, q.w);
    const k = s > 1e-12 ? ang / s : 2;
    return [q.x * k, q.y * k, q.z * k];
  };
  const a = [0, 0, 0];
  for (let it = 0; it < 30; it++) {
    const r0 = residual(a);
    if (Math.hypot(...r0) < 1e-10) break;
    const J: number[][] = [[], [], []];
    const h = 1e-6;
    for (let j = 0; j < 3; j++) {
      const ap = a.slice();
      ap[j] += h;
      const rj = residual(ap);
      for (let i = 0; i < 3; i++) J[i][j] = (rj[i] - r0[i]) / h;
    }
    // solve J · δ = −r0 (3×3, Cramer)
    const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(J);
    if (Math.abs(D) < 1e-14) break;
    for (let j = 0; j < 3; j++) {
      const Mj = J.map((row, i) => row.map((v, c) => (c === j ? -r0[i] : v)));
      a[j] += det(Mj) / D;
    }
  }
  const DEG = 180 / Math.PI;
  const R = new Matrix4().makeRotationFromQuaternion(quat(a));
  const pivot = v3(frame.pivot);
  const t = new Vector3().setFromMatrixPosition(T);
  // T·x = R(x − p) + p + d  ⇒  d = t − p + R·p
  const d = t.sub(pivot).add(pivot.clone().applyMatrix4(R));
  return { mesial: d.dot(M), buccal: d.dot(B), extrusion: d.dot(O), tip: a[1] * DEG, torque: a[2] * DEG, rotation: a[0] * DEG };
}
