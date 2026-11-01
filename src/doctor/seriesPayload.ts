import type { BufferGeometry } from 'three';
import { BufferAttribute, BufferGeometry as Geometry } from 'three';
import { strToU8, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import type { Arch } from '../core/fdi';
import { sequence, toothNumber } from '../core/fdi';
import { ArchModel, seedRadiusMm } from '../geometry/archModel';
import { autoSegmentSeeds } from '../geometry/autoSegment';
import { estimatePatientFrame, frameToMatrix } from '../geometry/orient';
import { buildStageSeries } from '../geometry/stageSeries';
import type { StageSeries } from '../geometry/stageSeries';
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

/** Positions of every stage of a series (shared layout) or of each stage mesh. */
function allPositions(s: StageSeries): Float32Array[] {
  return s.shared ? s.positions : s.meshes.map((m) => m.positions);
}

/**
 * Doctor-viewer package built only from exported stage models (no segmentation or plan needed):
 * the models are oriented automatically, optionally coloured teeth/gum, and every stage is stored.
 */
export function buildSeriesPackage(input: SeriesInput): { pkg: Uint8Array; stages: number } {
  const files: Zippable = {};
  const series: Partial<Record<Arch, StageSeries>> = {};
  const names: Partial<Record<Arch, string[]>> = {};
  for (const arch of ['upper', 'lower'] as Arch[]) {
    const list = input.arches[arch];
    if (!list?.length) continue;
    const sorted = list.slice().sort((a, b) => a.stage - b.stage);
    input.onProgress?.(`Reading ${sorted.length} ${arch} stages…`);
    series[arch] = buildStageSeries(sorted.map((x) => x.geometry));
    names[arch] = sorted.map((x) => x.name);
  }
  // orientation from the first stage of each arch (patient frame: +X right, +Y anterior, +Z up)
  const firstModels = (['upper', 'lower'] as Arch[])
    .filter((a) => series[a])
    .map((arch) => {
      const s = series[arch]!;
      const g = new Geometry();
      g.setAttribute('position', new BufferAttribute((s.shared ? s.positions[0] : s.meshes[0].positions).slice(), 3));
      g.setIndex(new BufferAttribute(s.shared ? s.index : s.meshes[0].index, 1));
      return { arch, model: new ArchModel(arch, g) };
    });
  const M = frameToMatrix(estimatePatientFrame(firstModels));
  const e = M.elements;
  for (const s of Object.values(series)) {
    for (const p of allPositions(s!)) {
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        p[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
        p[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        p[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
    }
  }
  const archMeta: Partial<Record<Arch, SeriesArchMeta>> = {};
  let total = 0;
  for (const arch of ['upper', 'lower'] as Arch[]) {
    const s = series[arch];
    if (!s) continue;
    const pos = allPositions(s);
    total = Math.max(total, pos.length - 1);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of pos) for (let i = 0; i < p.length; i++) (min[i % 3] = Math.min(min[i % 3], p[i])), (max[i % 3] = Math.max(max[i % 3], p[i]));
    const scale = [0, 1, 2].map((k) => Math.max(1e-6, (max[k] - min[k]) / 65000)) as [number, number, number];
    const offset = [0, 1, 2].map((k) => (max[k] + min[k]) / 2) as [number, number, number];
    const quant = (p: Float32Array) => {
      const q = new Int16Array(p.length);
      for (let i = 0; i < p.length; i++) q[i] = Math.round((p[i] - offset[i % 3]) / scale[i % 3]);
      return q;
    };
    let colored = false;
    if (s.shared) {
      files[`${arch}.idx`] = u8(s.index);
      const q0 = quant(s.positions[0]);
      files[`${arch}.pos0`] = u8(q0);
      // later stages as differences from stage 0: unmoved gum compresses to almost nothing
      s.positions.slice(1).forEach((p, k) => {
        const q = quant(p);
        for (let i = 0; i < q.length; i++) q[i] -= q0[i];
        files[`${arch}.d${k + 1}`] = u8(q);
      });
      if (input.colorize) {
        try {
          input.onProgress?.(`Colouring ${arch} teeth…`);
          const g = new Geometry();
          g.setAttribute('position', new BufferAttribute(s.positions[0].slice(), 3));
          g.setIndex(new BufferAttribute(s.index, 1));
          const model = new ArchModel(arch, g);
          const auto = autoSegmentSeeds(model, arch, sequence(arch).filter((t) => toothNumber(t) <= 7));
          for (const sd of auto.teeth) model.addSeed(sd.v, sd.tooth);
          model.paintVertices(auto.gum, 0);
          model.segment((id) => seedRadiusMm(id));
          files[`${arch}.tooth`] = Uint8Array.from(model.labels, (l) => (l ? 1 : 0));
          colored = true;
        } catch {
          colored = false;
        }
      }
    } else {
      s.meshes.forEach((m, k) => {
        files[`${arch}.m${k}.idx`] = u8(m.index);
        files[`${arch}.m${k}.pos`] = u8(quant(m.positions));
      });
    }
    archMeta[arch] = { stages: pos.length, shared: s.shared, vertexCount: pos[0].length / 3, scale, offset, colored, names: names[arch]! };
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
