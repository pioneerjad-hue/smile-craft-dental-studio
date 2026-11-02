import type { BufferGeometry } from 'three';
import { BufferAttribute, BufferGeometry as Geometry } from 'three';
import { strToU8, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import type { Arch } from '../core/fdi';
import { ArchModel } from '../geometry/archModel';
import { classifyModel } from '../geometry/classify';
import { estimatePatientFrame, frameToMatrix } from '../geometry/orient';
import { buildStageGroups } from '../geometry/stageSeries';
import type { StageGroup } from '../geometry/stageSeries';
import { DOCTOR_FORMAT } from './format';
import type { DoctorMeta, SeriesArchMeta } from './format';

const u8 = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

export interface SeriesInput {
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
export function buildSeriesPackage(input: SeriesInput): { pkg: Uint8Array; stages: number } {
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
  // orientation from the first stage of each arch (patient frame: +X right, +Y anterior, +Z up)
  const firstModels = (['upper', 'lower'] as Arch[])
    .filter((a) => series[a])
    .map((arch) => {
      const g0 = series[arch]![0];
      const g = new Geometry();
      g.setAttribute('position', new BufferAttribute(g0.positions[0].slice(), 3));
      g.setIndex(new BufferAttribute(g0.index, 1));
      return { arch, model: new ArchModel(arch, g) };
    });
  const M = frameToMatrix(estimatePatientFrame(firstModels));
  const e = M.elements;
  for (const groups of Object.values(series)) {
    for (const grp of groups!) {
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
  return { pkg: zipSync(files, { level: 6 }), stages: total };
}
