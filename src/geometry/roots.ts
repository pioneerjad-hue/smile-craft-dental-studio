import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { archOf, toothNumber } from '../core/fdi';
import { v3 } from '../core/transform';
import type { ToothFrame } from '../core/types';
import type { ArchModel } from './archModel';

/**
 * Artificial (template) roots built from the crown, as used when no CBCT is available:
 * the cervical cross-section of the crown is lofted along the long axis to the apex, tapering
 * with root length. Root count follows typical anatomy:
 *   upper molars 3 (mesio-buccal, disto-buccal, palatal), upper first premolar 2 (buccal, palatal),
 *   lower molars 2 (mesial, distal), all other teeth 1.
 * Roots are for visualisation, apex movement and root-proximity checks; they are not printed.
 */
const SECTORS = 32;

function rootDirections(id: number, M: Vector3, B: Vector3): Vector3[] {
  const n = toothNumber(id);
  if (archOf(id) === 'upper') {
    if (n === 6 || n === 7) return [M.clone().multiplyScalar(0.55).addScaledVector(B, 0.8), M.clone().multiplyScalar(-0.55).addScaledVector(B, 0.8), B.clone().negate()].map((d) => d.normalize());
    if (n === 4) return [B.clone(), B.clone().negate()];
  } else if (n === 6 || n === 7) return [M.clone(), M.clone().negate()];
  return [];
}

export function buildRootGeometry(model: ArchModel, frame: ToothFrame): BufferGeometry | null {
  if (!frame.cervical || !frame.rootLengthMm) return null;
  const C = v3(frame.cervical);
  const O = v3(frame.occlusal), M = v3(frame.mesial), B = v3(frame.buccal);
  const L = frame.rootLengthMm;
  // cervical cross-section radius per angular sector from the margin vertices
  const radius = new Float32Array(SECTORS);
  const v = new Vector3();
  for (const vi of model.toothVertices(frame.id)) {
    let margin = false;
    for (let j = model.adjOffsets[vi]; j < model.adjOffsets[vi + 1]; j++) if (model.labels[model.adj[j]] === 0) margin = true;
    if (!margin) continue;
    model.position(vi, v).sub(C);
    const x = v.dot(M), y = v.dot(B);
    const a = Math.atan2(y, x);
    const k = Math.floor(((a + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS;
    radius[k] = Math.max(radius[k], Math.hypot(x, y));
  }
  // fill empty sectors, then shrink slightly so the root sits inside the crown margin
  const filled = radius.filter((r) => r > 0);
  const mean = filled.length ? filled.reduce((a, b) => a + b, 0) / filled.length : frame.autoWidthMm / 2;
  for (let k = 0; k < SECTORS; k++) {
    if (radius[k] > 0) continue;
    let a = 1, b = 1;
    while (radius[(k - a + SECTORS) % SECTORS] === 0 && a < SECTORS) a++;
    while (radius[(k + b) % SECTORS] === 0 && b < SECTORS) b++;
    const ra = radius[(k - a + SECTORS) % SECTORS] || mean, rb = radius[(k + b) % SECTORS] || mean;
    radius[k] = (ra * b + rb * a) / (a + b);
  }
  for (let k = 0; k < SECTORS; k++) radius[k] = Math.min(radius[k], mean * 1.3) * 0.85;

  const pos: number[] = [];
  const idx: number[] = [];
  /** Loft rings along `axis` from `start`; profile(t) scales the cross-section; returns nothing. */
  const loft = (start: Vector3, axis: Vector3, length: number, rScale: number, profile: (t: number) => number, sectorRadius: (k: number) => number) => {
    const rings = 14;
    const base = pos.length / 3;
    const u = M.clone().addScaledVector(axis, -M.dot(axis)).normalize();
    const w = new Vector3().crossVectors(axis, u);
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const c = start.clone().addScaledVector(axis, length * t);
      for (let k = 0; k < SECTORS; k++) {
        const a = -Math.PI + ((k + 0.5) / SECTORS) * 2 * Math.PI;
        const rr = sectorRadius(k) * rScale * profile(t);
        const p = c.clone().addScaledVector(u, Math.cos(a) * rr).addScaledVector(w, Math.sin(a) * rr);
        pos.push(p.x, p.y, p.z);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < SECTORS; k++) {
        const a = base + r * SECTORS + k, b = base + r * SECTORS + ((k + 1) % SECTORS);
        idx.push(a, a + SECTORS, b, b, a + SECTORS, b + SECTORS);
      }
    }
    // rounded apex cap
    const apex = start.clone().addScaledVector(axis, length + 0.4);
    const ai = pos.length / 3;
    pos.push(apex.x, apex.y, apex.z);
    const lastRing = base + rings * SECTORS;
    for (let k = 0; k < SECTORS; k++) idx.push(lastRing + k, ai, lastRing + ((k + 1) % SECTORS));
  };
  const down = O.clone().negate();
  const taper = (t: number) => Math.max(0.12, 1 - 0.82 * Math.pow(t, 1.4));
  const dirs = rootDirections(frame.id, M, B);
  if (!dirs.length) {
    loft(C, down, L, 1, taper, (k) => radius[k]);
  } else {
    // root trunk to the furcation, then individual roots diverging slightly
    const trunk = Math.min(4, L * 0.3);
    loft(C, down, trunk, 1, (t) => 1 - 0.1 * t, (k) => radius[k]);
    const forkC = C.clone().addScaledVector(down, trunk);
    const rootR = mean * 0.85 * (dirs.length === 3 ? 0.42 : 0.5);
    for (const d of dirs) {
      const start = forkC.clone().addScaledVector(d, mean * 0.35);
      const axis = down.clone().addScaledVector(d, 0.15).normalize();
      loft(start, axis, L - trunk, 1, taper, () => rootR);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Closest distance between two segments (used for root-proximity checks). */
export function segmentDistance(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  const c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
  s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
  t = (b * s + f) / e;
  if (t < 0) (t = 0), (s = Math.min(1, Math.max(0, -c / a)));
  else if (t > 1) (t = 1), (s = Math.min(1, Math.max(0, (b - c) / a)));
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}
