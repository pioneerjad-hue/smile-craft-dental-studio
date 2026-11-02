import { BufferAttribute, BufferGeometry } from 'three';
import type { Arch } from '../core/fdi';
import { sequence, toothNumber } from '../core/fdi';
import { Vector3 } from 'three';
import { ArchModel, crownHeightLimitMm, seedRadiusMm } from './archModel';
import { autoSegmentSeeds } from './autoSegment';

export const GUM = 0;
export const TOOTH = 1;
export const ATTACHMENT = 2;

/**
 * Colour classes for an exported stage model (patient coordinates, +Z up), per vertex:
 * 0 = gingiva, 1 = tooth, 2 = attachment.
 *
 * Exported transition models are usually several shells: the gingiva (+ teeth, or teeth as their own
 * shells, possibly with roots) and small attachment shells. Shells under 6.5 mm (bounding-box diagonal)
 * are attachments, shells under 60 % of the arch size are teeth; when ≥ 4 tooth shells exist the
 * largest shell is the gingiva, otherwise it contains gum and teeth and is split automatically.
 */
export function classifyModel(arch: Arch, positions: Float32Array, index: Uint32Array): Uint8Array {
  const n = positions.length / 3;
  const flags = new Uint8Array(n);
  // connected components (union-find over triangles)
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let f = 0; f < index.length; f += 3) {
    const a = find(index[f]);
    parent[find(index[f + 1])] = a;
    parent[find(index[f + 2])] = a;
  }
  const comps = new Map<number, { verts: number[]; min: number[]; max: number[] }>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let c = comps.get(r);
    if (!c) comps.set(r, (c = { verts: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
    c.verts.push(i);
    for (let k = 0; k < 3; k++) (c.min[k] = Math.min(c.min[k], positions[3 * i + k])), (c.max[k] = Math.max(c.max[k], positions[3 * i + k]));
  }
  const list = [...comps.values()].map((c) => ({ ...c, diag: Math.hypot(c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]) }));
  list.sort((a, b) => b.verts.length - a.verts.length);
  const largest = list[0];
  // Size classes relative to the arch: a tooth shell (crown, or crown + root) is far smaller than the
  // gingiva/arch shell; an attachment is a few millimetres.
  const toothMax = Math.max(25, (largest?.diag ?? 60) * 0.6);
  const cls = (d: number) => (d < 6.5 ? ATTACHMENT : d < toothMax ? TOOTH : GUM);
  const toothShells = list.slice(1).filter((c) => cls(c.diag) === TOOTH);
  for (const c of list.slice(1)) {
    const k = cls(c.diag);
    for (const v of c.verts) flags[v] = k;
  }
  if (toothShells.length >= 4 || !largest) return flags; // gingiva is its own shell (already 0)
  // largest shell = gum + teeth: segment it automatically
  try {
    const remap = new Int32Array(n).fill(-1);
    largest.verts.forEach((v, k) => (remap[v] = k));
    const pos = new Float32Array(largest.verts.length * 3);
    largest.verts.forEach((v, k) => pos.set([positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]], 3 * k));
    const idx: number[] = [];
    for (let f = 0; f < index.length; f += 3) if (remap[index[f]] >= 0) idx.push(remap[index[f]], remap[index[f + 1]], remap[index[f + 2]]);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex(idx);
    const model = new ArchModel(arch, g);
    const auto = autoSegmentSeeds(model, arch, sequence(arch).filter((t) => toothNumber(t) <= 7));
    for (const sd of auto.teeth) model.addSeed(sd.v, sd.tooth);
    model.paintVertices(auto.gum, 0);
    model.segment((id) => seedRadiusMm(id), 0, { up: new Vector3(0, 0, arch === 'lower' ? 1 : -1), limitFor: crownHeightLimitMm });
    largest.verts.forEach((v, k) => (flags[v] = model.labels[k] ? TOOTH : GUM));
  } catch {
    /* leave as gingiva */
  }
  return flags;
}
