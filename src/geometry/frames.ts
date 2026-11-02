import { Quaternion, Vector3 } from 'three';
import { mesialStep, sequence, toothNumber } from '../core/fdi';
import { tuple } from '../core/transform';
import type { AxisCorrection, Protocol, ToothFrame } from '../core/types';
import type { ArchModel } from './archModel';

/** Eigen-decomposition of a symmetric 3×3 matrix (Jacobi). Returns eigenvectors sorted by ascending eigenvalue. */
export function symmetricEigen(m: number[][]): { values: number[]; vectors: Vector3[] } {
  const a = m.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] * a[i][j];
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const pairs = [0, 1, 2].map((i) => ({ value: a[i][i], vector: new Vector3(v[0][i], v[1][i], v[2][i]).normalize() }));
  pairs.sort((x, y) => x.value - y.value);
  return { values: pairs.map((p) => p.value), vectors: pairs.map((p) => p.vector) };
}

export function pca(points: Vector3[]): { mean: Vector3; values: number[]; vectors: Vector3[] } {
  const mean = new Vector3();
  points.forEach((p) => mean.add(p));
  mean.multiplyScalar(1 / Math.max(1, points.length));
  const c = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of points) {
    const d = [p.x - mean.x, p.y - mean.y, p.z - mean.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += d[i] * d[j];
  }
  return { mean, ...symmetricEigen(c) };
}

/** Occlusal-plane normal of an arch scan, oriented from the gingiva toward the crowns. */
export function archOcclusalNormal(model: ArchModel, centroids: Vector3[]): Vector3 {
  const step = Math.max(1, Math.floor(model.vertexCount / 20000));
  const pts: Vector3[] = [];
  for (let i = 0; i < model.vertexCount; i += step) pts.push(model.position(i));
  const meshPca = pca(pts);
  let normal = meshPca.vectors[0].clone();
  if (centroids.length >= 4) {
    const tp = pca(centroids);
    // Only trust the centroid plane when the teeth span a real 2-D arch.
    if (tp.values[1] > 4 * Math.max(tp.values[0], 1e-6)) normal = tp.vectors[0].clone();
  }
  // Orientation: crowns stick out of the occlusal side. Compare tooth vertices with gingiva vertices,
  // or (before segmentation) use the mean vertex normal, which points out of the open scan's surface.
  const L = model.labels;
  let toothSide = 0, gumSide = 0, tCount = 0, gCount = 0;
  for (let i = 0; i < model.vertexCount; i += step) {
    const d = model.position(i).dot(normal);
    if (L[i]) (toothSide += d), tCount++;
    else (gumSide += d), gCount++;
  }
  if (tCount > 10 && gCount > 10) {
    if (toothSide / tCount < gumSide / gCount) normal.negate();
  } else {
    let s = 0, n = 0;
    for (let i = 0; i < model.vertexCount; i += step) {
      s += model.normals[3 * i] * normal.x + model.normals[3 * i + 1] * normal.y + model.normals[3 * i + 2] * normal.z;
      n++;
    }
    if (Math.abs(s) > 0.08 * n) {
      // open scan: the surface normals point out of the occlusal side
      if (s < 0) normal.negate();
    } else {
      // closed model (with a base): the normals cancel out. The scanned teeth side carries far more
      // vertices than the flat base, so the vertex centroid sits toward the teeth.
      let lo = Infinity, hi = -Infinity, mean = 0;
      for (const p of pts) {
        const d = p.dot(normal);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
        mean += d;
      }
      mean /= Math.max(1, pts.length);
      if (mean < (lo + hi) / 2) normal.negate();
    }
  }
  return normal.normalize();
}

/**
 * Clinical frames for every segmented tooth of an arch.
 * occlusal = crown long axis: cervical-margin centre → cusp tips/incisal edge (or the occlusal-plane
 *            normal when axisMode = 'occlusalPlane' or the crown axis is implausible)
 * mesial   = arch tangent through neighbouring crowns, pointing to the midline, ⟂ occlusal
 * buccal   = perpendicular, pointing out of the arch
 * Optional per-tooth corrections (tip / torque / rotation, degrees) rotate the frame.
 * Roots: apex = cervical centre − occlusal × root length; centre of resistance at
 * `centerOfResistanceRatio` of the root length.
 */
export function computeArchFrames(
  model: ArchModel,
  protocol: Protocol,
  perTooth: Record<number, { axisCorrection?: AxisCorrection; rootLengthMm?: number }> = {},
): Record<number, ToothFrame> {
  const present = new Set(model.teeth());
  const ids = sequence(model.arch).filter((id) => present.has(id));
  const stats = new Map(ids.map((id) => [id, model.toothStats(id)]));
  const centroids = ids.map((id) => stats.get(id)!.centroid);
  const plane = archOcclusalNormal(model, centroids);
  const center = new Vector3();
  centroids.forEach((c) => center.add(c));
  center.multiplyScalar(1 / Math.max(1, centroids.length));
  const bio = protocol.biomechanics;

  const frames: Record<number, ToothFrame> = {};
  ids.forEach((id, i) => {
    const c = stats.get(id)!.centroid;
    const verts = stats.get(id)!.vertices;
    const v = new Vector3();
    // cervical centre: mean of the crown vertices bordering the gingiva
    const cerv = new Vector3();
    let nCerv = 0;
    let maxH = -Infinity, minH = Infinity;
    for (const vi of verts) {
      const h = model.position(vi, v).dot(plane);
      maxH = Math.max(maxH, h);
      minH = Math.min(minH, h);
      let margin = false;
      for (let j = model.adjOffsets[vi]; j < model.adjOffsets[vi + 1]; j++) if (model.labels[model.adj[j]] === 0) margin = true;
      if (margin) cerv.add(v), nCerv++;
    }
    if (nCerv) cerv.multiplyScalar(1 / nCerv);
    else cerv.copy(c).addScaledVector(plane, minH - c.dot(plane));
    let O = plane.clone();
    if (bio.axisMode !== 'occlusalPlane') {
      // Long axis: least-squares line through the centres of horizontal crown slices between 35 % and
      // 90 % of the crown height. The cervical band is excluded so papillae / margin irregularities
      // do not tilt the axis.
      const A = crownAxisFromSlices(model, verts, plane, minH, maxH);
      if (A && A.dot(plane) > Math.cos((40 * Math.PI) / 180)) O = A;
    }
    const flat = (u: Vector3) => u.addScaledVector(O, -u.dot(O));
    const prev = i > 0 ? centroids[i - 1] : null;
    const next = i + 1 < ids.length ? centroids[i + 1] : null;
    let T: Vector3;
    if (prev && next) T = next.clone().sub(prev);
    else if (next) T = next.clone().sub(c);
    else if (prev) T = c.clone().sub(prev);
    else T = new Vector3(1, 0, 0);
    flat(T);
    if (T.lengthSq() < 1e-9) T = flat(new Vector3(1, 0, 0));
    T.normalize();
    let M = T.multiplyScalar(mesialStep(id));
    let B = new Vector3().crossVectors(O, M).normalize();
    const outward = c.clone().sub(center);
    outward.addScaledVector(plane, -outward.dot(plane));
    if (outward.lengthSq() > 1e-6 && B.dot(outward) < 0) B.negate();
    M = new Vector3().crossVectors(B, O).normalize().multiplyScalar(Math.sign(new Vector3().crossVectors(B, O).dot(M)) || 1);

    const corr = perTooth[id]?.axisCorrection;
    if (corr && (corr.tip || corr.torque || corr.rotation)) {
      const D = Math.PI / 180;
      const q = new Quaternion()
        .setFromAxisAngle(new Vector3().crossVectors(O, B).normalize(), corr.torque * D)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3().crossVectors(O, M).normalize(), corr.tip * D))
        .multiply(new Quaternion().setFromAxisAngle(new Vector3().crossVectors(B, M).normalize(), corr.rotation * D));
      M.applyQuaternion(q);
      B.applyQuaternion(q);
      O.applyQuaternion(q);
    }

    // crown height along O; mesio-distal width at contact level (35–90 % of crown height)
    const ms = new Float32Array(verts.length);
    const os = new Float32Array(verts.length);
    let minO = Infinity, maxO = -Infinity;
    verts.forEach((vi, k) => {
      model.position(vi, v).sub(c);
      ms[k] = v.dot(M);
      os[k] = v.dot(O);
      minO = Math.min(minO, os[k]);
      maxO = Math.max(maxO, os[k]);
    });
    const lo = minO + 0.35 * (maxO - minO);
    const hi = minO + 0.9 * (maxO - minO);
    let minM = Infinity, maxM = -Infinity;
    for (let k = 0; k < verts.length; k++) {
      if (os[k] < lo || os[k] > hi) continue;
      minM = Math.min(minM, ms[k]);
      maxM = Math.max(maxM, ms[k]);
    }
    const rootLen = perTooth[id]?.rootLengthMm ?? bio.rootLengthMm[model.arch][toothNumber(id) - 1] ?? 13;
    const apex = cerv.clone().addScaledVector(O, -rootLen);
    const pivot = cerv.clone().addScaledVector(O, -rootLen * bio.centerOfResistanceRatio);
    frames[id] = {
      id,
      centroid: tuple(c),
      mesial: tuple(M),
      buccal: tuple(B),
      occlusal: tuple(O),
      pivot: tuple(pivot),
      autoWidthMm: Number.isFinite(maxM) ? maxM - minM : 0,
      crownHeightMm: Number.isFinite(maxO) ? maxO - minO : 0,
      cervical: tuple(cerv),
      apex: tuple(apex),
      rootLengthMm: rootLen,
    };
  });
  return frames;
}

/** Up to `max` evenly spread crown vertices, used for exact per-stage displacement checks. */
export function crownSamples(model: ArchModel, id: number, max = 96): [number, number, number][] {
  const verts = model.toothVertices(id);
  const step = Math.max(1, Math.floor(verts.length / max));
  const out: [number, number, number][] = [];
  for (let i = 0; i < verts.length; i += step) {
    const v = verts[i];
    out.push([model.base[3 * v], model.base[3 * v + 1], model.base[3 * v + 2]]);
  }
  return out;
}

/** Crown long axis from the centres of horizontal slices (35–90 % of crown height). */
function crownAxisFromSlices(model: ArchModel, verts: Uint32Array, plane: Vector3, minH: number, maxH: number): Vector3 | null {
  const e1 = Math.abs(plane.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  e1.addScaledVector(plane, -e1.dot(plane)).normalize();
  const e2 = new Vector3().crossVectors(plane, e1);
  const slices = 6;
  const pts: { h: number; x: number; y: number }[] = [];
  const v = new Vector3();
  for (let k = 0; k < slices; k++) {
    const lo = minH + (0.35 + (0.55 * k) / slices) * (maxH - minH);
    const hi = minH + (0.35 + (0.55 * (k + 1)) / slices) * (maxH - minH);
    let sx = 0, sy = 0, n = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const vi of verts) {
      model.position(vi, v);
      const h = v.dot(plane);
      if (h < lo || h >= hi) continue;
      const x = v.dot(e1), y = v.dot(e2);
      sx += x; sy += y; n++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    // bounding-box centre is insensitive to uneven vertex density on the shell
    if (n >= 8) pts.push({ h: (lo + hi) / 2, x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }
  if (pts.length < 3) return null;
  const mh = pts.reduce((a, p) => a + p.h, 0) / pts.length;
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let shh = 0, shx = 0, shy = 0;
  for (const p of pts) {
    shh += (p.h - mh) ** 2;
    shx += (p.h - mh) * (p.x - mx);
    shy += (p.h - mh) * (p.y - my);
  }
  if (shh < 1e-9) return null;
  return plane.clone().addScaledVector(e1, shx / shh).addScaledVector(e2, shy / shh).normalize();
}
