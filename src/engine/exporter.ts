import { Matrix4 } from 'three';
import { zipSync, strToU8 } from 'fflate';
import type { Zippable } from 'fflate';
import type { Arch } from '../core/fdi';
import { shortLabel, sortTeeth } from '../core/fdi';
import { crownDisplacement } from '../core/transform';
import { movementAtStage } from '../core/staging';
import { ATTACHMENT_LABEL, MOVEMENT_KEYS, MOVEMENT_META } from '../core/types';
import { bolton, spaceAnalysis, toothWidth } from '../core/analysis';
import { buildPlanningBrief } from '../core/aiBrief';
import { writeBinaryStl } from '../geometry/io';
import { toPts } from '../geometry/trimLine';
import { getState, setState, toast } from './store';
import { studio } from './studio';
import { download, safeName } from './project';

export interface ExportOptions {
  from: number;
  to: number;
  arches: Arch[];
  attachments: boolean;
  /** Also export the attachment template model (stage 0 with attachments) when attachments exist. */
  template: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Build the binary STL of one arch at one stage (deformed scan + attachments). */
export function stageStl(arch: Arch, stage: number, withAttachments: boolean): Uint8Array {
  const m = studio.models[arch];
  if (!m) throw new Error(`No ${arch} scan`);
  const T = studio.transformsAt(stage, arch);
  const deformed = studio.positionsAt(arch, stage);
  const base = studio.baseFor(arch, stage);
  const parts: { positions: ArrayLike<number>; index?: ArrayLike<number> }[] = [];
  if (base) {
    // Closed solid: scan surface + walls + flat base sharing the border vertices.
    const positions = new Float32Array(deformed.length + base.positions.length);
    positions.set(deformed);
    positions.set(base.positions, deformed.length);
    const index = new Uint32Array(m.index.length + base.index.length);
    index.set(m.index);
    index.set(base.index, m.index.length);
    parts.push({ positions, index });
  } else parts.push({ positions: deformed, index: m.index });
  if (withAttachments) {
    const { plan } = getState();
    for (const tp of Object.values(plan.teeth)) {
      if ((tp.id < 30) !== (arch === 'upper')) continue;
      for (const att of tp.attachments) {
        if (stage < att.stageFrom) continue;
        const g = studio.attachmentGeometryFor(tp.id, att);
        if (!g) continue;
        g.applyMatrix4(T.get(tp.id) ?? new Matrix4());
        parts.push({ positions: g.getAttribute('position').array });
      }
    }
  }
  for (const p of getState().plan.pontics ?? []) {
    if ((p.id < 30) !== (arch === 'upper') || stage < p.stageFrom) continue;
    const g = studio.ponticGeometry(p);
    if (!g) continue;
    const shift = studio.ponticShift(p.id, stage);
    g.translate(shift.x, shift.y, shift.z);
    parts.push({ positions: g.getAttribute('position').array, index: g.index!.array });
  }
  const { caseInfo } = getState();
  return writeBinaryStl(parts, `Smile Craft ${caseInfo.caseId} ${arch} stage ${stage}`);
}

export async function exportStages(opts: ExportOptions) {
  const s = getState();
  const base = safeName(s.caseInfo.caseId || s.caseInfo.patientName);
  const files: Zippable = {};
  const manifest = ['case_id,patient,arch,stage,file,attachments,aligner_wear_days'];
  const hasAttachments = Object.values(s.plan.teeth).some((t) => t.attachments.length);
  const jobs: { arch: Arch; stage: number; att: boolean; name: string }[] = [];
  for (const arch of opts.arches) {
    if (!studio.models[arch]) continue;
    const letter = arch === 'upper' ? 'U' : 'L';
    for (let st = opts.from; st <= opts.to; st++) {
      jobs.push({ arch, stage: st, att: opts.attachments, name: `${base}_${letter}_S${pad(st)}.stl` });
    }
    if (opts.template && hasAttachments) jobs.push({ arch, stage: 0, att: true, name: `${base}_${letter}_TEMPLATE.stl` });
  }
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    setState({ busy: `Building ${j.name} (${i + 1}/${jobs.length})…` });
    await new Promise((r) => setTimeout(r, 0));
    files[`${base}/${j.name}`] = [stageStl(j.arch, j.stage, j.att), { level: 1 }];
    if (s.modelBuilder.trimLines && !j.name.includes('TEMPLATE')) {
      const line = studio.trimLineAt(j.arch, j.stage);
      if (line.length > 1) files[`${base}/trimlines/${j.name.replace(/\.stl$/, '.pts')}`] = strToU8(toPts(line));
    }
    manifest.push([s.caseInfo.caseId, s.caseInfo.patientName, j.arch, j.stage, j.name, j.att ? 'yes' : 'no', s.protocol.staging.daysPerStage].map(csv).join(','));
  }
  files[`${base}/manifest.csv`] = strToU8(manifest.join('\n'));
  files[`${base}/treatment-plan.json`] = strToU8(JSON.stringify(planSummary(), null, 2));
  files[`${base}/staging-table.csv`] = strToU8(stagingTableCsv());
  setState({ busy: 'Compressing…' });
  await new Promise((r) => setTimeout(r, 0));
  const zip = zipSync(files);
  setState({ busy: null });
  download(zip, `${base}_print_stages.zip`, 'application/zip');
  toast(`Exported ${jobs.length} STL models.`, 'success');
}

function csv(v: unknown) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function planSummary() {
  const s = getState();
  return {
    case: s.caseInfo,
    protocol: { name: s.protocol.name, version: s.protocol.version },
    stages: s.staging ? { total: s.staging.totalStages, upper: s.staging.archStages.upper, lower: s.staging.archStages.lower, weeks: s.staging.weeks } : null,
    teeth: sortTeeth(Object.keys(s.plan.teeth).map(Number)).map((id) => {
      const tp = s.plan.teeth[id];
      return { id, ...tp.movement, startStage: tp.startStage, locked: !!tp.locked, extracted: !!tp.extracted, attachments: tp.attachments.map((a) => ({ type: a.type, stageFrom: a.stageFrom })) };
    }),
    ipr: s.plan.ipr,
    notes: s.plan.notes,
  };
}

/** Cumulative movement of every tooth at every stage (CSV, one row per tooth per stage). */
export function stagingTableCsv(): string {
  const s = getState();
  const total = s.staging?.totalStages ?? 0;
  const ids = sortTeeth(Object.keys(s.plan.teeth).map(Number)).filter((id) => MOVEMENT_KEYS.some((k) => Math.abs(s.plan.teeth[id].movement[k]) > 1e-9));
  const rows = ['stage,tooth,layer,mesial_mm,buccal_mm,extrusion_mm,tip_deg,torque_deg,rotation_deg'];
  for (let st = 0; st <= total; st++) {
    for (const id of ids) {
      const tp = s.plan.teeth[id];
      const m = movementAtStage(tp, s.staging?.teeth[id], st);
      rows.push([st, id, tp.layer ?? 1, ...MOVEMENT_KEYS.map((k) => m[k].toFixed(3))].join(','));
    }
  }
  return rows.join('\n');
}

export function exportPlanningBrief() {
  const s = getState();
  const brief = buildPlanningBrief({ caseInfo: s.caseInfo, protocol: s.protocol, plan: s.plan, frames: s.frames, staging: s.staging, contacts: s.contacts });
  download(JSON.stringify(brief, null, 2), `${safeName(s.caseInfo.caseId || 'case')}_planning-brief.json`, 'application/json');
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Printable treatment-plan report (opens the browser print dialog → save as PDF). */
export function openReport() {
  const s = getState();
  const shot = studio.viewer?.screenshot() ?? '';
  const ids = sortTeeth(Object.keys(s.plan.teeth).map(Number));
  const moving = ids.filter((id) => MOVEMENT_KEYS.some((k) => Math.abs(s.plan.teeth[id].movement[k]) > 1e-6));
  const fmt = (n: number) => (Math.abs(n) < 1e-6 ? '–' : n.toFixed(2));
  const rows = moving
    .map((id) => {
      const tp = s.plan.teeth[id];
      const f = s.frames[id];
      const disp = f ? crownDisplacement(f, tp.movement).total : 0;
      const st = s.staging?.teeth[id];
      return `<tr><td><b>${id}</b> ${shortLabel(id)}</td>${MOVEMENT_KEYS.map((k) => `<td>${fmt(tp.movement[k])}</td>`).join('')}<td>${disp.toFixed(2)}</td><td>${st ? `${st.start}–${st.end}` : ''}</td><td>${tp.attachments.map((a) => ATTACHMENT_LABEL[a.type]).join(', ')}</td></tr>`;
    })
    .join('');
  const ipr = s.plan.ipr
    .slice()
    .sort((a, b) => a.stage - b.stage)
    .map((e) => `<tr><td>${e.contact}</td><td>${e.amountMm.toFixed(2)} mm</td><td>before aligner ${e.stage}</td></tr>`)
    .join('');
  const ba = bolton(s.plan, s.frames, 'anterior');
  const bo = bolton(s.plan, s.frames, 'overall');
  const space = (['upper', 'lower'] as Arch[]).map((a) => spaceAnalysis(a, s.plan, s.frames)).filter(Boolean);
  const issues = s.issues.map((i) => `<li class="${i.severity}">${esc(i.message)}</li>`).join('');
  const occ0 = studio.occlusionAt(0);
  const occ1 = s.staging?.totalStages ? studio.occlusionAt(s.staging.totalStages) : null;
  const occ = occ0
    ? `<p>Overjet ${occ0.overjetMm.toFixed(1)}${occ1 ? ` → ${occ1.overjetMm.toFixed(1)}` : ''} mm · Overbite ${occ0.overbiteMm.toFixed(1)}${occ1 ? ` → ${occ1.overbiteMm.toFixed(1)}` : ''} mm · Midline ${occ0.midlineMm.toFixed(1)}${occ1 ? ` → ${occ1.midlineMm.toFixed(1)}` : ''} mm</p>`
    : '';
  const widths = ids.map((id) => `<td>${id}<br/><b>${(toothWidth(s.plan, s.frames, id) ?? 0).toFixed(1)}</b></td>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Treatment plan ${esc(s.caseInfo.caseId)}</title>
<style>body{font:12px/1.45 system-ui,sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #ccc}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:3px 5px;text-align:center}th{background:#f3f4f6}
.meta{color:#555}img{max-width:100%;border:1px solid #ddd;border-radius:6px;background:#fafafa}.error{color:#b91c1c}.warning{color:#b45309}
.sig{margin-top:30px;display:flex;gap:40px}.sig div{flex:1;border-top:1px solid #333;padding-top:4px}</style></head><body>
<h1>Clear aligner treatment plan</h1>
<div class="meta">Patient: <b>${esc(s.caseInfo.patientName)}</b> · Case: <b>${esc(s.caseInfo.caseId)}</b> · Clinician: ${esc(s.caseInfo.clinician)} · ${new Date().toLocaleDateString()}</div>
<div class="meta">Protocol: ${esc(s.protocol.name)} (v${s.protocol.version}) · Stages: <b>${s.staging?.totalStages ?? 0}</b> (upper ${s.staging?.archStages.upper ?? 0}, lower ${s.staging?.archStages.lower ?? 0}) · ${s.protocol.staging.daysPerStage} days/aligner · ≈ ${Math.ceil(s.staging?.weeks ?? 0)} weeks</div>
${shot ? `<h2>Final position</h2><img src="${shot}"/>` : ''}
<h2>Tooth movements (final)</h2><table><tr><th>Tooth</th>${MOVEMENT_KEYS.map((k) => `<th>${MOVEMENT_META[k].label}<br/>(${MOVEMENT_META[k].unit}, + ${MOVEMENT_META[k].positive})</th>`).join('')}<th>Crown Δ mm</th><th>Stages</th><th>Attachments</th></tr>${rows || '<tr><td colspan="11">No movements planned</td></tr>'}</table>
<h2>IPR</h2>${ipr ? `<table><tr><th>Contact</th><th>Amount</th><th>When</th></tr>${ipr}</table>` : 'None'}
<h2>Analysis</h2>${occ}<p>Bolton anterior ${ba.ratio.toFixed(1)}% (ideal ${ba.ideal}%) · overall ${bo.ratio.toFixed(1)}% (ideal ${bo.ideal}%)</p>
${space.map((sp) => `<p>${sp!.arch}: available ${sp!.availableMm.toFixed(1)} mm, required ${sp!.requiredMm.toFixed(1)} mm → ${sp!.discrepancyMm < 0 ? 'crowding' : 'spacing'} ${Math.abs(sp!.discrepancyMm).toFixed(1)} mm</p>`).join('')}
<table><tr>${widths}</tr></table>
<h2>Protocol check</h2>${issues ? `<ul>${issues}</ul>` : '<p>All protocol checks passed.</p>'}
${s.plan.notes ? `<h2>Notes</h2><p>${esc(s.plan.notes)}</p>` : ''}
<div class="sig"><div>Clinician approval</div><div>Date</div></div>
<script>setTimeout(()=>print(),400)</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to open the report.', 'error');
  w.document.write(html);
  w.document.close();
}

/** Wrap a doctor package and the viewer runtime into one HTML document. */
async function doctorHtml(pkg: Uint8Array, title: string): Promise<string> {
  const runtime = (await import('../../dist-doctor/runtime.js?raw')).default as string;
  const { viewerHtml } = await import('../doctor/html');
  return viewerHtml(pkg, title, runtime);
}

/**
 * Doctor viewer straight from stage models exported by other software (e.g. Maestro → STL per
 * stage): no segmentation or planning needed.
 */
export async function exportSeriesViewer(files: { arch: Arch; stage: number; name: string; buffer: ArrayBuffer }[], notes: string, colorize: boolean) {
  const s = getState();
  setState({ busy: 'Reading exported stages…' });
  await new Promise((r) => setTimeout(r, 0));
  try {
    const { parseScan } = await import('../geometry/io');
    const { buildSeriesPackage } = await import('../doctor/seriesPayload');
    const arches: Partial<Record<Arch, { stage: number; name: string; geometry: ReturnType<typeof parseScan> }[]>> = {};
    for (const f of files) (arches[f.arch] ??= []).push({ stage: f.stage, name: f.name, geometry: parseScan(f.buffer, f.name) });
    const { pkg, stages } = buildSeriesPackage({
      arches,
      lab: s.lab,
      caseInfo: { patientName: s.caseInfo.patientName, caseId: s.caseInfo.caseId, clinician: s.caseInfo.clinician, notes: s.caseInfo.notes },
      notes,
      colorize,
      onProgress: (text) => setState({ busy: text }),
    });
    setState({ busy: 'Writing viewer…' });
    await new Promise((r) => setTimeout(r, 0));
    const title = `${s.lab.name ? s.lab.name + ' — ' : ''}Treatment plan ${s.caseInfo.caseId || s.caseInfo.patientName}`;
    const html = await doctorHtml(pkg, title);
    download(html, `${safeName(s.caseInfo.caseId || s.caseInfo.patientName)}_doctor-viewer.html`, 'text/html');
    toast(`Doctor viewer exported: ${stages} aligners (${(html.length / 1048576).toFixed(1)} MB).`, 'success');
  } catch (e) {
    toast(`Doctor viewer failed: ${(e as Error).message}`, 'error');
  } finally {
    setState({ busy: null });
  }
}

/**
 * Single-file doctor viewer: the case package (models, stages, IPR, attachments…) plus the viewer
 * runtime in one HTML file that opens in any browser, offline, including on phones.
 */
export async function exportDoctorViewer() {
  const s = getState();
  setState({ busy: 'Building doctor viewer…' });
  await new Promise((r) => setTimeout(r, 0));
  try {
    const { buildDoctorPackage } = await import('../doctor/payload');
    const pkg = buildDoctorPackage(s.lab);
    const title = `${s.lab.name ? s.lab.name + ' — ' : ''}Treatment plan ${s.caseInfo.caseId || s.caseInfo.patientName}`;
    const html = await doctorHtml(pkg, title);
    download(html, `${safeName(s.caseInfo.caseId || s.caseInfo.patientName)}_doctor-viewer.html`, 'text/html');
    toast(`Doctor viewer exported (${(html.length / 1048576).toFixed(1)} MB). Send it by email or WhatsApp.`, 'success');
  } catch (e) {
    toast(`Doctor viewer failed: ${(e as Error).message}`, 'error');
  } finally {
    setState({ busy: null });
  }
}
