import { orientWinding } from '../geometry/winding';
import type { BufferGeometry } from 'three';
import { strToU8, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import type { Arch } from '../core/fdi';
import { classifyModel } from '../geometry/classify';
import { biteTransforms } from '../geometry/bite';
import { Vector3 } from 'three';
import { buildStageGroups } from '../geometry/stageSeries';
import type { StageGroup } from '../geometry/stageSeries';
import { DOCTOR_FORMAT } from './format';
import type { DoctorMeta, SeriesArchMeta } from './format';

const u8 = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

export interface SeriesInput {
  /** Initial scans of the arches in occlusion (e.g. from the intraoral scanner) to restore the real bite. */
  biteScans?: Partial<Record<Arch, BufferGeometry>>;
  /** Manual nudge of the upper arch (mm, patient coordinates: x right, y anterior, z up). */
  biteAdjust?: [number, number, number];
  arches: Partial<Record<Arch, { stage: number; name: string; geometry: BufferGeometry }[]>>;
  lab: DoctorMeta['lab'];
  caseInfo: DoctorMeta['caseInfo'];
  notes: string;
  colorize: boolean;
  onProgress?: (text: string) => void;
}


/** Per-vertex colour classes (0 gingiva, 1 tooth, 2 attachment), or null if classification fails. */
function toothFlags(arch: Arch, positions: Float32Array, index: Uint32Array): Uint8Array | null {
  try {
    return classifyModel(arch, positions, index);
  } catch {
    return null;
  }
}

/**
 * Doctor-viewer package built only from exported stage models (no segmentation or plan needed):
 * the models are oriented automatically, optionally coloured teeth/gum, and every stage is stored.
 */
export function buildSeriesPackage(input: SeriesInput): { pkg: Uint8Array; stages: number; biteSource: string } {
  const files: Zippable = {};
  const series: Partial<Record<Arch, StageGroup[]>> = {};
  const names: Partial<Record<Arch, string[]>> = {};
  for (const arch of ['upper', 'lower'] as Arch[]) {
    const list = input.arches[arch];
    if (!list?.length) continue;
    const sorted = list.slice().sort((a, b) => a.stage - b.stage);
    input.onProgress?.(`Reading ${sorted.length} ${arch} stages…`);
    series[arch] = buildStageGroups(sorted.map((x) => x.geometry));
    names[arch] = sorted.map((x) => x.name);
  }
  // bite and orientation (patient frame: +X right, +Y anterior, +Z up)
  input.onProgress?.('Setting up the bite…');
  const meshOf = (g: BufferGeometry) => {
    const ng = g.index ? g : g.toNonIndexed();
    const series0 = buildStageGroups([ng])[0];
    return { positions: series0.positions[0], index: series0.index };
  };
  const stage0: Partial<Record<Arch, { positions: Float32Array; index: Uint32Array }>> = {};
  for (const arch of ['upper', 'lower'] as Arch[]) if (series[arch]) stage0[arch] = { positions: series[arch]![0].positions[0], index: series[arch]![0].index };
  const scans: Partial<Record<Arch, { positions: Float32Array; index: Uint32Array }>> = {};
  for (const arch of ['upper', 'lower'] as Arch[]) if (input.biteScans?.[arch]) scans[arch] = meshOf(input.biteScans[arch]!);
  const adj = input.biteAdjust ?? [0, 0, 0];
  const bite = biteTransforms(stage0, scans, new Vector3(adj[0], adj[1], adj[2]));
  for (const arch of ['upper', 'lower'] as Arch[]) {
    const groups = series[arch];
    if (!groups) continue;
    const e = bite.transforms[arch]!.elements;
    for (const grp of groups) {
      for (const p of grp.positions) {
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i], y = p[i + 1], z = p[i + 2];
          p[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
          p[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          p[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        }
      }
    }
  }
  // consistent outward-facing triangles (inward-facing exported shells render black)
  for (const arch of ['upper', 'lower'] as Arch[]) for (const grp of series[arch] ?? []) orientWinding(grp.positions[0], grp.index);
  const archMeta: Partial<Record<Arch, SeriesArchMeta>> = {};
  let total = 0;
  for (const arch of ['upper', 'lower'] as Arch[]) {
    const groups = series[arch];
    if (!groups) continue;
    const stageCount = groups.reduce((n, g) => n + g.positions.length, 0);
    total = Math.max(total, stageCount - 1);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const g of groups) for (const p of g.positions) for (let i = 0; i < p.length; i++) (min[i % 3] = Math.min(min[i % 3], p[i])), (max[i % 3] = Math.max(max[i % 3], p[i]));
    const scale = [0, 1, 2].map((k) => Math.max(1e-6, (max[k] - min[k]) / 65000)) as [number, number, number];
    const offset = [0, 1, 2].map((k) => (max[k] + min[k]) / 2) as [number, number, number];
    const quant = (p: Float32Array) => {
      const q = new Int16Array(p.length);
      for (let i = 0; i < p.length; i++) q[i] = Math.round((p[i] - offset[i % 3]) / scale[i % 3]);
      return q;
    };
    let colored = false;
    groups.forEach((g, gi) => {
      const key = `${arch}.g${gi}`;
      files[`${key}.idx`] = u8(g.index);
      const q0 = quant(g.positions[0]);
      files[`${key}.pos0`] = u8(q0);
      // later stages of the run as differences from its first stage: unmoved areas compress to nothing
      g.positions.slice(1).forEach((p, k) => {
        const q = quant(p);
        for (let i = 0; i < q.length; i++) q[i] -= q0[i];
        files[`${key}.d${k + 1}`] = u8(q);
      });
      if (input.colorize) {
        input.onProgress?.(`Colouring ${arch} models (${gi + 1}/${groups.length})…`);
        const flags = toothFlags(arch, g.positions[0], g.index);
        if (flags) {
          files[`${key}.tooth`] = flags;
          colored = true;
        }
      }
    });
    archMeta[arch] = {
      stages: stageCount,
      groups: groups.map((g) => ({ from: g.from, count: g.positions.length, vertexCount: g.positions[0].length / 3 })),
      scale,
      offset,
      colored,
      names: names[arch]!,
    };
  }
  const meta: DoctorMeta = {
    format: DOCTOR_FORMAT,
    mode: 'series',
    series: archMeta,
    biteSource: bite.source,
    doctorNotes: input.notes,
    createdAt: new Date().toISOString(),
    lab: input.lab,
    caseInfo: input.caseInfo,
    totalStages: total,
    archStages: { upper: (archMeta.upper?.stages ?? 1) - 1, lower: (archMeta.lower?.stages ?? 1) - 1 },
    daysPerStage: 7,
    colors: { gum: '#de8f99', tooth: '#f5f0e0' },
    oriented: true,
    arches: {},
    teeth: [],
    ipr: [],
    occlusion: { initial: null, final: null },
    planNotes: '',
  };
  files['meta.json'] = strToU8(JSON.stringify(meta));
  return { pkg: zipSync(files, { level: 6 }), stages: total, biteSource: bite.source };
}
