/**
 * Simulation Viewer Builder — standalone tool.
 * Drop the transition models (one STL/PLY/OBJ per stage and arch), enter the patient and doctor, and it
 * reconstructs the treatment simulation: gingiva pink, teeth white, attachments orange, with a step
 * navigator. The result is one HTML file to send to the doctor (opens offline, also on phones).
 */
import type { Arch } from '../core/fdi';
import { parseExportName } from '../core/reference';
import { parseScan } from '../geometry/io';
import { readM3d } from '../geometry/m3d';
import { buildSeriesPackage } from '../doctor/seriesPayload';
import { viewerHtml } from '../doctor/html';
import runtime from '../../dist-doctor/runtime.js?raw';

const CSS = `
:root{--bg:#0b1220;--panel:#111a2c;--line:#24314d;--text:#e6edf7;--muted:#8ea0bf;--accent:#38bdf8;color-scheme:dark;font:14px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}
main{max-width:860px;margin:0 auto;padding:28px 18px 60px;display:flex;flex-direction:column;gap:18px}
h1{margin:0;font-size:24px}.sub{color:var(--muted)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}
h2{margin:0;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:640px){.grid{grid-template-columns:1fr}}
label{display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:12px}
input[type=text],select{background:#0a1324;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:8px 10px;font:inherit}
input:focus,select:focus{outline:none;border-color:var(--accent)}
button{font:inherit;color:inherit;background:#16223a;border:1px solid var(--line);border-radius:8px;padding:9px 14px;cursor:pointer}
button.primary{background:#0ea5e9;border-color:#0ea5e9;color:#031321;font-weight:700}button:disabled{opacity:.45;cursor:not-allowed}
.drop{border:1.5px dashed var(--line);border-radius:12px;padding:26px;text-align:center;color:var(--muted)}
.drop.over{border-color:var(--accent);background:#0c4a6e33}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:5px 4px;border-bottom:1px solid #1d2942;text-align:left}th{color:var(--muted);font-weight:500}
td input{width:70px}input[type=file]{color:var(--muted);font-size:12px}.ok{color:#86efac}.warn{color:#fcd34d}.muted{color:var(--muted)}
.status{min-height:20px}`;

interface Item {
  file: File;
  arch: Arch | null;
  stage: number | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stageText = (s: number | null) => (s === null ? '' : s === Number.POSITIVE_INFINITY ? 'final' : String(s));

function render() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  $('app').innerHTML = `
  <main>
    <div><h1>Simulation Viewer</h1><div class="sub">Rebuild a treatment simulation from the transition models of a case and send it to the doctor as one file.</div></div>
    <div class="card">
      <h2>1 · Case</h2>
      <div class="grid">
        <label>Patient name<input type="text" id="patient" placeholder="Patient"></label>
        <label>Doctor name<input type="text" id="doctor" placeholder="Doctor"></label>
        <label>Case ID (optional)<input type="text" id="caseId"></label>
        <label>Lab name (optional)<input type="text" id="lab"></label>
      </div>
      <details><summary class="muted">Doctor replies (optional): add your email or WhatsApp to show Approve / Request changes buttons</summary>
        <div class="grid" style="margin-top:8px">
          <label>Reply email<input type="text" id="email"></label>
          <label>WhatsApp<input type="text" id="wa" placeholder="+961 …"></label>
        </div>
      </details>
    </div>
    <div class="card">
      <h2>2 · Transition models</h2>
      <div class="drop" id="drop">Drop the exported stage models here (STL, PLY or OBJ — one per stage and arch).<br>Add the .m3d too to fill in the patient and doctor.
        <div class="row" style="justify-content:center;margin-top:12px"><button id="pickFolder">Choose folder…</button><button id="pickFiles">Choose files…</button></div>
      </div>
      <input type="file" id="files" multiple accept=".stl,.ply,.obj,.m3d" hidden>
      <input type="file" id="folder" webkitdirectory hidden>
      <div id="list"></div>
    </div>
    <div class="card">
      <h2>3 · Bite</h2>
      <div class="muted">If the exported models are not in occlusion, add the patient's <b>initial scans with the bite</b> (upper and lower as exported from the intraoral scanner): each arch is matched onto its scan to restore the real bite. Without them the bite is estimated from the models.</div>
      <div class="grid">
        <label>Upper initial scan (optional)<input type="file" id="biteU" accept=".stl,.ply,.obj"></label>
        <label>Lower initial scan (optional)<input type="file" id="biteL" accept=".stl,.ply,.obj"></label>
      </div>
      <div class="muted">Fine adjustment of the upper arch (mm): + right, + forward, + up</div>
      <div class="row">
        <label style="width:90px">Right/left<input type="text" id="adjX" value="0"></label>
        <label style="width:90px">Forward/back<input type="text" id="adjY" value="0"></label>
        <label style="width:90px">Up/down<input type="text" id="adjZ" value="0"></label>
      </div>
    </div>
    <div class="card">
      <h2>4 · Simulation</h2>
      <label style="max-width:360px">Colours<select id="colour"><option value="auto">Automatic — gingiva pink, teeth white, attachments orange</option><option value="plain">One colour (model colour)</option></select></label>
      <div class="row"><button class="primary" id="build" disabled>Build simulation</button><button id="open" disabled>Open simulation</button><button id="save" disabled>Save viewer for the doctor (.html)</button></div>
      <div class="status muted" id="status"></div>
    </div>
  </main>`;
}

let items: Item[] = [];
let html = '';

function renderList() {
  const ready = items.filter((i) => i.arch && i.stage !== null);
  const count = (a: Arch) => ready.filter((i) => i.arch === a).length;
  $('build').toggleAttribute('disabled', !ready.length);
  if (!items.length) return ($('list').innerHTML = '');
  $('list').innerHTML = `<div class="muted">${count('upper')} upper · ${count('lower')} lower stages ready — check arch and stage (0 = initial, "final" = last).</div>
    <table><tr><th>File</th><th>Arch</th><th>Stage</th></tr>${items
      .map(
        (it, i) => `<tr><td>${it.file.name.replace(/[<>&]/g, '')}</td><td><select data-i="${i}" data-k="arch"><option value="">—</option><option value="upper" ${it.arch === 'upper' ? 'selected' : ''}>Upper</option><option value="lower" ${it.arch === 'lower' ? 'selected' : ''}>Lower</option></select></td><td><input type="text" data-i="${i}" data-k="stage" value="${stageText(it.stage)}"></td></tr>`,
      )
      .join('')}</table>`;
  $('list').querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-i]').forEach((el) => {
    el.onchange = () => {
      const it = items[+el.dataset.i!];
      if (el.dataset.k === 'arch') it.arch = (el.value || null) as Arch | null;
      else {
        const v = el.value.trim().toLowerCase();
        it.stage = v === '' ? null : v.startsWith('f') ? Number.POSITIVE_INFINITY : Number.isFinite(+v) ? Math.max(0, Math.round(+v)) : null;
      }
      renderList();
    };
  });
}

async function addFiles(list: FileList | File[]) {
  const all = Array.from(list);
  const m3d = all.find((f) => /\.m3d$/i.test(f.name));
  if (m3d) {
    // only the readable case details (patient, doctor) — the models themselves come from the exports
    const info = readM3d(await m3d.arrayBuffer(), m3d.name).info;
    if (info.patientName && !$<HTMLInputElement>('patient').value) $<HTMLInputElement>('patient').value = info.patientName;
    if (info.doctorName && !$<HTMLInputElement>('doctor').value) $<HTMLInputElement>('doctor').value = info.doctorName;
  }
  items = all.filter((f) => /\.(stl|ply|obj)$/i.test(f.name)).map((file) => ({ file, ...parseExportName(file.name) }));
  html = '';
  $('open').setAttribute('disabled', '');
  $('save').setAttribute('disabled', '');
  renderList();
}

const status = (text: string, cls = 'muted') => {
  $('status').className = `status ${cls}`;
  $('status').textContent = text;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

async function build() {
  const ready = items.filter((i) => i.arch && i.stage !== null);
  if (!ready.length) return;
  $('build').setAttribute('disabled', '');
  try {
    status('Reading models…');
    await tick();
    const arches: Parameters<typeof buildSeriesPackage>[0]['arches'] = {};
    for (const it of ready) {
      (arches[it.arch!] ??= []).push({ stage: it.stage!, name: it.file.name, geometry: parseScan(await it.file.arrayBuffer(), it.file.name) });
    }
    const v = (id: string) => $<HTMLInputElement>(id).value.trim();
    const biteScans: Parameters<typeof buildSeriesPackage>[0]['biteScans'] = {};
    for (const [id, arch] of [['biteU', 'upper'], ['biteL', 'lower']] as const) {
      const f = $<HTMLInputElement>(id).files?.[0];
      if (f) biteScans[arch] = parseScan(await f.arrayBuffer(), f.name);
    }
    const num = (id: string) => (Number.isFinite(parseFloat(v(id))) ? parseFloat(v(id)) : 0);
    const { pkg, stages, biteSource } = buildSeriesPackage({
      biteScans,
      biteAdjust: [num('adjX'), num('adjY'), num('adjZ')],
      arches,
      lab: { name: v('lab'), email: v('email'), whatsapp: v('wa') },
      caseInfo: { patientName: v('patient'), caseId: v('caseId'), clinician: v('doctor'), notes: '' },
      notes: '',
      colorize: $<HTMLSelectElement>('colour').value === 'auto',
      onProgress: (t) => status(t),
    });
    html = viewerHtml(pkg, `Treatment simulation${v('patient') ? ' — ' + v('patient') : ''}`, runtime);
    const biteText = { export: 'bite as exported', scans: 'bite restored from the initial scans', estimated: 'bite estimated — add the initial scans for the real bite, or adjust', single: 'one arch' }[biteSource] ?? '';
    status(`Simulation ready: ${stages} aligners · ${biteText} · ${(html.length / 1048576).toFixed(1)} MB`, biteSource === 'estimated' ? 'warn' : 'ok');
    $('open').removeAttribute('disabled');
    $('save').removeAttribute('disabled');
  } catch (e) {
    status(`Could not build the simulation: ${(e as Error).message}`, 'warn');
  } finally {
    $('build').removeAttribute('disabled');
  }
}

function fileName() {
  const v = ($<HTMLInputElement>('caseId').value || $<HTMLInputElement>('patient').value || 'case').trim();
  return `${v.replace(/[^\w-]+/g, '_') || 'case'}_simulation.html`;
}

render();
$('pickFiles').onclick = () => $('files').click();
$('pickFolder').onclick = () => $('folder').click();
$<HTMLInputElement>('files').onchange = (e) => void addFiles((e.target as HTMLInputElement).files ?? []);
$<HTMLInputElement>('folder').onchange = (e) => void addFiles((e.target as HTMLInputElement).files ?? []);
const drop = $('drop');
drop.ondragover = (e) => (e.preventDefault(), drop.classList.add('over'));
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  void addFiles(e.dataTransfer?.files ?? []);
};
$('build').onclick = () => void build();
$('open').onclick = () => window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
$('save').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = fileName();
  a.click();
};
