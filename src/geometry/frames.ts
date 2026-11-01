import { Vector3 } from 'three';
import { mesialStep, sequence, toothType } from '../core/fdi';
import { tuple } from '../core/transform';
import type { Protocol, ToothFrame } from '../core/types';
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
    let s = 0;
    for (let i = 0; i < model.vertexCount; i += step) {
      s += model.normals[3 * i] * normal.x + model.normals[3 * i + 1] * normal.y + model.normals[3 * i + 2] * normal.z;
    }
    if (s < 0) normal.negate();
  }
  return normal.normalize();
}

/**
 * Clinical frames for every segmented tooth of an arch.
 * mesial  = arch tangent through neighbouring crown centroids, pointing to the midline
 * occlusal= occlusal-plane normal
 * buccal  = in-plane perpendicular pointing away from the arch centre
 */
export function computeArchFrames(model: ArchModel, protocol: Protocol): Record<number, ToothFrame> {
  const present = new Set(model.teeth());
  const ids = sequence(model.arch).filter((id) => present.has(id));
  const stats = new Map(ids.map((id) => [id, model.toothStats(id)]));
  const centroids = ids.map((id) => stats.get(id)!.centroid);
  const O = archOcclusalNormal(model, centroids);
  const center = new Vector3();
  centroids.forEach((c) => center.add(c));
  center.multiplyScalar(1 / Math.max(1, centroids.length));
  const flat = (v: Vector3) => v.addScaledVector(O, -v.dot(O));

  const frames: Record<number, ToothFrame> = {};
  ids.forEach((id, i) => {
    const c = stats.get(id)!.centroid;
    const prev = i > 0 ? centroids[i - 1] : null;
    const next = i + 1 < ids.length ? centroids[i + 1] : null;
    // Tangent in increasing-sequence direction (patient right → left).
    let T: Vector3;
    if (prev && next) T = next.clone().sub(prev);
    else if (next) T = next.clone().sub(c);
    else if (prev) T = c.clone().sub(prev);
    else T = new Vector3(1, 0, 0);
    flat(T);
    if (T.lengthSq() < 1e-9) T = flat(new Vector3(1, 0, 0));
    T.normalize();
    const M = T.multiplyScalar(mesialStep(id));
    const B = new Vector3().crossVectors(O, M).normalize();
    const outward = flat(c.clone().sub(center));
    if (outward.lengthSq() > 1e-6 ? B.dot(outward) < 0 : false) B.negate();

    // Crown height along O, then mesio-distal width at contact level (35–90 % of the crown height
    // from the margin): the cervical band is excluded because papillae and fused contacts make the
    // segmentation boundary unreliable there, and the contact points lie in the middle/occlusal third.
    const verts = stats.get(id)!.vertices;
    const v = new Vector3();
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
    const pivot = c.clone().addScaledVector(O, -protocol.biomechanics.pivotApicalMm[toothType(id)]);
    frames[id] = {
      id,
      centroid: tuple(c),
      mesial: tuple(M),
      buccal: tuple(B),
      occlusal: tuple(O),
      pivot: tuple(pivot),
      autoWidthMm: Number.isFinite(maxM) ? maxM - minM : 0,
      crownHeightMm: Number.isFinite(maxO) ? maxO - minO : 0,
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
