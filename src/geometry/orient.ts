import { Matrix4, Vector3 } from 'three';
import type { Arch } from '../core/fdi';
import type { ArchModel } from './archModel';
import { archOcclusalNormal, pca } from './frames';

/**
 * Patient coordinate system used everywhere after orientation:
 *   +X = patient's right, +Y = anterior, +Z = up (occlusal plane horizontal), origin = arch centre.
 */
export interface PatientFrame {
  origin: Vector3;
  right: Vector3;
  anterior: Vector3;
  up: Vector3;
}

/** World → patient-frame matrix. */
export function frameToMatrix(f: PatientFrame): Matrix4 {
  const m = new Matrix4().makeBasis(f.right, f.anterior, f.up).transpose(); // rows = axes
  const t = f.origin.clone().applyMatrix4(m).negate();
  m.setPosition(t);
  return m;
}

function samplePoints(model: ArchModel, max = 25000): Vector3[] {
  const step = Math.max(1, Math.floor(model.vertexCount / max));
  const out: Vector3[] = [];
  for (let i = 0; i < model.vertexCount; i += step) out.push(model.position(i));
  return out;
}

/**
 * Automatic orientation of one or two scanned arches (kept in occlusion).
 * - up: occlusal-plane normal from PCA, signed by the scan's surface normals (lower teeth face up,
 *   upper teeth face down)
 * - anterior: the mid-sagittal direction is the in-plane axis of best mirror symmetry; its sign points
 *   to the narrow (incisor) end of the U-shaped arch
 */
export function estimatePatientFrame(arches: { arch: Arch; model: ArchModel }[]): PatientFrame {
  let up = new Vector3();
  for (const { arch, model } of arches) {
    const n = archOcclusalNormal(model, []);
    if (arch === 'upper') n.negate();
    if (up.lengthSq() > 0 && up.dot(n) < 0) n.negate();
    up.add(n);
  }
  up.normalize();
  const pts = arches.flatMap(({ model }) => samplePoints(model, 25000 / arches.length));
  const origin = pca(pts).mean;
  // 2-D coordinates in the occlusal plane
  const e1 = Math.abs(up.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  e1.addScaledVector(up, -e1.dot(up)).normalize();
  const e2 = new Vector3().crossVectors(up, e1);
  const P = pts.map((p) => {
    const d = p.clone().sub(origin);
    return [d.dot(e1), d.dot(e2)] as [number, number];
  });
  // Mirror-symmetry search over the sagittal direction (1° steps, 0–180°).
  const cell = 1.5;
  let best = { score: -1, theta: 0 };
  for (let deg = 0; deg < 180; deg++) {
    const th = (deg * Math.PI) / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const hist = new Map<number, number>();
    const keys: [number, number][] = [];
    for (const [x, y] of P) {
      const u = Math.round((x * c + y * s) / cell);
      const v = Math.round((-x * s + y * c) / cell);
      keys.push([u, v]);
      const k = u * 4096 + v;
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    let overlap = 0;
    for (const [k, n] of hist) {
      const u = Math.round(k / 4096);
      const v = k - u * 4096;
      overlap += Math.min(n, hist.get(u * 4096 - v) ?? 0);
    }
    if (overlap > best.score) best = { score: overlap, theta: th };
  }
  const sag = e1.clone().multiplyScalar(Math.cos(best.theta)).addScaledVector(e2, Math.sin(best.theta)).normalize();
  const lat = new Vector3().crossVectors(up, sag);
  // Anterior = half of the arch with the smaller lateral spread (incisors), posterior = molars.
  const vals = pts.map((p) => p.clone().sub(origin));
  const along = vals.map((d) => d.dot(sag));
  const median = [...along].sort((a, b) => a - b)[Math.floor(along.length / 2)];
  const spread = (sel: (a: number) => boolean) => {
    const xs = vals.filter((_, i) => sel(along[i])).map((d) => d.dot(lat));
    const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length));
  };
  const anterior = spread((a) => a > median) < spread((a) => a <= median) ? sag : sag.clone().negate();
  const right = new Vector3().crossVectors(anterior, up).normalize();
  return { origin, right, anterior: anterior.normalize(), up };
}

/**
 * Orientation from three clicked landmarks: incisal point between the central incisors and the
 * mesio-buccal cusps of the right and left first molars.
 */
export function frameFromLandmarks(incisal: Vector3, rightMolar: Vector3, leftMolar: Vector3, upHint: Vector3): PatientFrame {
  let up = new Vector3().subVectors(rightMolar, incisal).cross(new Vector3().subVectors(leftMolar, incisal)).normalize();
  if (up.dot(upHint) < 0) up.negate();
  const right = new Vector3().subVectors(rightMolar, leftMolar);
  right.addScaledVector(up, -right.dot(up)).normalize();
  const anterior = new Vector3().crossVectors(up, right).normalize();
  const mid = rightMolar.clone().add(leftMolar).multiplyScalar(0.5);
  if (anterior.dot(new Vector3().subVectors(incisal, mid)) < 0) {
    // clicks were mirrored relative to the up hint: trust the clicked right/left and the incisor
    up = up.negate();
  }
  const ant = new Vector3().crossVectors(up, right).normalize();
  const origin = incisal.clone().add(mid).multiplyScalar(0.5);
  return { origin, right, anterior: ant, up };
}
