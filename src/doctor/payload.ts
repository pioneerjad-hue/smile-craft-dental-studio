import { Matrix4 } from 'three';
import { strToU8, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import type { Arch } from '../core/fdi';
import { sortTeeth } from '../core/fdi';
import { ATTACHMENT_LABEL, MOVEMENT_KEYS } from '../core/types';
import { getState } from '../engine/store';
import { studio } from '../engine/studio';
import { DOCTOR_FORMAT } from './format';
import type { DoctorArchMeta, DoctorMeta } from './format';

const u8 = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** Package the current case (models, stages, IPR, attachments …) for the doctor viewer. */
export function buildDoctorPackage(lab: DoctorMeta['lab']): Uint8Array {
  const s = getState();
  const total = s.staging?.totalStages ?? 0;
  const files: Zippable = {};
  const arches: DoctorMeta['arches'] = {};
  for (const arch of ['upper', 'lower'] as Arch[]) {
    const m = studio.models[arch];
    if (!m) continue;
    const key = arch;
    // positions quantized to int16 per axis (≈ 2–3 µm steps)
    const n = m.vertexCount;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], m.base[3 * i + k])), (max[k] = Math.max(max[k], m.base[3 * i + k]));
    const scale = [0, 1, 2].map((k) => Math.max(1e-6, (max[k] - min[k]) / 65000)) as [number, number, number];
    const offset = [0, 1, 2].map((k) => (max[k] + min[k]) / 2) as [number, number, number];
    const q = new Int16Array(3 * n);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) q[3 * i + k] = Math.round((m.base[3 * i + k] - offset[k]) / scale[k]);
    files[`${key}.pos`] = u8(q);
    files[`${key}.idx`] = u8(m.index);
    files[`${key}.lab`] = new Uint8Array(m.labels);
    const gw = m.gumWeights();
    files[`${key}.gv`] = u8(gw.vtx);
    files[`${key}.gt`] = new Uint8Array(gw.tooth);
    files[`${key}.gw`] = u8(gw.w);
    // tooth transforms for every stage
    const teeth = m.teeth().sort((a, b) => a - b);
    const mats = new Float32Array((total + 1) * teeth.length * 16);
    for (let st = 0; st <= total; st++) {
      const T = studio.transformsAt(st, arch);
      teeth.forEach((id, j) => mats.set((T.get(id) ?? new Matrix4()).elements, (st * teeth.length + j) * 16));
    }
    files[`${key}.stages`] = u8(mats);
    const meta: DoctorArchMeta = { teeth, scale, offset, vertexCount: n, extracted: [], attachments: [], pontics: [] };
    for (const [id, plane] of studio.flattenAt(1, arch)) {
      meta.extracted.push({ id, point: [plane.point.x, plane.point.y, plane.point.z], normal: [plane.normal.x, plane.normal.y, plane.normal.z], fromStage: 1 });
    }
    // attachments (initial tooth coordinates; the viewer applies the tooth's stage matrix)
    let k = 0;
    for (const tp of Object.values(s.plan.teeth)) {
      if ((tp.id < 30) !== (arch === 'upper')) continue;
      for (const att of tp.attachments) {
        const g = studio.attachmentGeometryFor(tp.id, att);
        if (!g) continue;
        const file = `${key}.att${k++}`;
        files[file] = u8(new Float32Array(g.getAttribute('position').array as ArrayLike<number>));
        meta.attachments.push({ file, tooth: tp.id, stageFrom: att.stageFrom });
      }
    }
    // pontics: geometry + translation per stage
    for (const p of s.plan.pontics ?? []) {
      if ((p.id < 30) !== (arch === 'upper')) continue;
      const g = studio.ponticGeometry(p);
      if (!g) continue;
      const nonIndexed = g.index ? g.toNonIndexed() : g;
      const file = `${key}.pontic${p.id}`;
      files[file] = u8(new Float32Array(nonIndexed.getAttribute('position').array as ArrayLike<number>));
      const shifts = new Float32Array((total + 1) * 3);
      for (let st = 0; st <= total; st++) {
        const v = studio.ponticShift(p.id, st);
        shifts.set([v.x, v.y, v.z], st * 3);
      }
      files[`${file}.shift`] = u8(shifts);
      meta.pontics.push({ file, id: p.id, stageFrom: p.stageFrom });
    }
    arches[arch] = meta;
  }
  const occ = (st: number) => {
    const o = studio.occlusionAt(st);
    return o ? { overjetMm: o.overjetMm, overbiteMm: o.overbiteMm, midlineMm: o.midlineMm } : null;
  };
  const meta: DoctorMeta = {
    format: DOCTOR_FORMAT,
    createdAt: new Date().toISOString(),
    lab,
    caseInfo: { patientName: s.caseInfo.patientName, caseId: s.caseInfo.caseId, clinician: s.caseInfo.clinician, notes: s.caseInfo.notes },
    totalStages: total,
    archStages: s.staging?.archStages ?? { upper: 0, lower: 0 },
    daysPerStage: s.protocol.staging.daysPerStage,
    colors: { gum: s.layers.upperGum.color, tooth: s.layers.upperTeeth.color },
    oriented: s.oriented,
    arches,
    teeth: sortTeeth(Object.keys(s.plan.teeth).map(Number)).map((id) => {
      const tp = s.plan.teeth[id];
      const st = s.staging?.teeth[id];
      return {
        id,
        movement: Object.fromEntries(MOVEMENT_KEYS.map((k) => [k, tp.movement[k]])),
        start: st?.start ?? 0,
        end: st?.end ?? 0,
        attachments: tp.attachments.map((a) => ATTACHMENT_LABEL[a.type]),
        extracted: !!tp.extracted,
      };
    }),
    ipr: s.plan.ipr,
    occlusion: { initial: occ(0), final: total ? occ(total) : null },
    planNotes: s.plan.notes,
  };
  files['meta.json'] = strToU8(JSON.stringify(meta));
  return zipSync(files, { level: 6 });
}
