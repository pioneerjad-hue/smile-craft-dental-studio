import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { HitPointInfo } from 'three-mesh-bvh';
import type { Arch } from '../core/fdi';
import { ArchModel } from './archModel';
import { archOcclusalNormal } from './frames';
import { estimatePatientFrame, frameToMatrix } from './orient';
import { bestRigid } from './registerSetup';

export type BiteSource = 'export' | 'scans' | 'estimated' | 'single';

export interface MeshData {
  positions: Float32Array;
  index: Uint32Array;
}

const model = (arch: Arch, m: MeshData) => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions.slice(), 3));
  g.setIndex(new BufferAttribute(m.index, 1));
  return new ArchModel(arch, g);
};

/** True when both arches are already positioned in occlusion (teeth facing each other, close together). */
export function inOcclusion(upper: ArchModel, lower: ArchModel): boolean {
  const nu = archOcclusalNormal(upper, []);
  const nl = archOcclusalNormal(lower, []);
  if (nu.dot(nl) > -0.7) return false;
  const centroid = (m: ArchModel) => {
    const c = new Vector3();
    for (let i = 0; i < m.vertexCount; i++) c.add(m.position(i));
    return c.multiplyScalar(1 / m.vertexCount);
  };
  const cu = centroid(upper), cl = centroid(lower);
  if (cu.clone().sub(cl).dot(nl) <= 0) return false;
  // lower crown tops vs upper crown tips along the lower occlusal direction
  let lowerTop = -Infinity, upperTip = Infinity;
  for (let i = 0; i < lower.vertexCount; i++) lowerTop = Math.max(lowerTop, lower.position(i).dot(nl));
  for (let i = 0; i < upper.vertexCount; i++) upperTip = Math.min(upperTip, upper.position(i).dot(nl));
  const lateral = cu.clone().sub(cl);
  lateral.addScaledVector(nl, -lateral.dot(nl));
  return Math.abs(upperTip - lowerTop) < 8 && lateral.length() < 20;
}

/** World → canonical frame of a single arch (teeth up for the lower, down for the upper). */
function canonical(arch: Arch, m: ArchModel): Matrix4 {
  return frameToMatrix(estimatePatientFrame([{ arch, model: m }]));
}

const applied = (m: ArchModel, M: Matrix4): Vector3[] => {
  const out: Vector3[] = [];
  const step = Math.max(1, Math.floor(m.vertexCount / 4000));
  for (let i = 0; i < m.vertexCount; i += step) out.push(m.position(i).applyMatrix4(M));
  return out;
};

/**
 * Rigid transform taking a stage model onto the scan of the same arch (both describe the same initial
 * teeth). Both are put in their canonical frames first, then aligned by trimmed ICP.
 */
export function registerToScan(arch: Arch, stage: ArchModel, scan: ArchModel): Matrix4 {
  const Cs = canonical(arch, stage), Cr = canonical(arch, scan);
  const refGeom = scan.geometry.clone();
  refGeom.applyMatrix4(Cr);
  const bvh = new MeshBVH(refGeom);
  const hit: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const pts = applied(stage, Cs);
  let T = new Matrix4();
  for (let it = 0; it < 80; it++) {
    const cutoff = Math.max(0.5, 4 - it * 0.08);
    const src: Vector3[] = [], dst: Vector3[] = [];
    for (const p of pts) {
      const x = p.clone().applyMatrix4(T);
      const r = bvh.closestPointToPoint(x, hit, 0, cutoff);
      if (r) (src.push(x), dst.push(r.point.clone()));
    }
    if (src.length < 20) break;
    const step = bestRigid(src, dst);
    T = step.multiply(T);
  }
  // stage → canonical(stage) → ICP → canonical(scan)⁻¹ → scan coordinates
  return Cr.clone().invert().multiply(T).multiply(Cs);
}

/**
 * Approximate bite when nothing better is available: both arches in their canonical frames, midlines
 * aligned, upper incisors ~1.5 mm in front of the lower ones, upper lowered until the posterior teeth
 * touch. Returns the translation applied to the upper arch (canonical coordinates).
 */
export function estimateBite(upperPts: Vector3[], lowerPts: Vector3[]): Vector3 {
  const yU = Math.max(...upperPts.map((p) => p.y));
  const yL = Math.max(...lowerPts.map((p) => p.y));
  const shift = new Vector3(0, yL + 1.5 - yU, 0);
  // height maps on a 1 mm grid: lower crown tops, upper crown tips (after the y shift)
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  const top = new Map<string, number>(), tip = new Map<string, number>();
  for (const p of lowerPts) {
    const k = key(p.x, p.y);
    top.set(k, Math.max(top.get(k) ?? -Infinity, p.z));
  }
  for (const p of upperPts) {
    const k = key(p.x + shift.x, p.y + shift.y);
    tip.set(k, Math.min(tip.get(k) ?? Infinity, p.z));
  }
  // first contact in the posterior half of the arch (incisors overlap vertically)
  const yCut = yL - 14;
  let need = -Infinity;
  for (const [k, z] of tip) {
    const y = +k.split(',')[1];
    if (y > yCut) continue;
    const t = top.get(k);
    if (t !== undefined) need = Math.max(need, t - z);
  }
  if (need === -Infinity) need = Math.max(...lowerPts.map((p) => p.z)) - Math.min(...upperPts.map((p) => p.z));
  shift.z = need;
  return shift;
}

/**
 * File → patient-coordinate transforms for the two arches of exported stage models.
 *  - 'export': already in occlusion → one shared frame
 *  - 'scans' : stage 0 registered onto the bite scans → real bite
 *  - 'estimated': arches oriented separately and an approximate bite built
 * `adjustUpper` (mm, patient coordinates) nudges the upper arch afterwards.
 */
export function biteTransforms(
  stage0: Partial<Record<Arch, MeshData>>,
  scans: Partial<Record<Arch, MeshData>>,
  adjustUpper = new Vector3(),
): { transforms: Partial<Record<Arch, Matrix4>>; source: BiteSource } {
  const arches = (['upper', 'lower'] as Arch[]).filter((a) => stage0[a]);
  const models = Object.fromEntries(arches.map((a) => [a, model(a, stage0[a]!)])) as Partial<Record<Arch, ArchModel>>;
  const adjust = new Matrix4().makeTranslation(adjustUpper.x, adjustUpper.y, adjustUpper.z);
  if (arches.length === 1) {
    const a = arches[0];
    return { transforms: { [a]: canonical(a, models[a]!) }, source: 'single' };
  }
  const U = models.upper!, L = models.lower!;
  if (scans.upper && scans.lower) {
    const su = model('upper', scans.upper), sl = model('lower', scans.lower);
    const F = frameToMatrix(estimatePatientFrame([{ arch: 'upper', model: su }, { arch: 'lower', model: sl }]));
    return {
      transforms: { upper: adjust.clone().multiply(F).multiply(registerToScan('upper', U, su)), lower: F.clone().multiply(registerToScan('lower', L, sl)) },
      source: 'scans',
    };
  }
  if (inOcclusion(U, L)) {
    const F = frameToMatrix(estimatePatientFrame([{ arch: 'upper', model: U }, { arch: 'lower', model: L }]));
    return { transforms: { upper: adjust.clone().multiply(F), lower: F }, source: 'export' };
  }
  const Cu = canonical('upper', U), Cl = canonical('lower', L);
  const t = estimateBite(applied(U, Cu), applied(L, Cl));
  return { transforms: { upper: adjust.clone().multiply(new Matrix4().makeTranslation(t.x, t.y, t.z)).multiply(Cu), lower: Cl }, source: 'estimated' };
}
