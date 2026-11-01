/**
 * Smile Craft doctor viewer — standalone runtime embedded in the exported HTML file.
 * Reads the case package from `window.__SMILE_CASE__` (base64 zip) and shows every aligner stage,
 * IPR, attachments and movements, with Approve / Request changes replies to the lab.
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { strFromU8, unzipSync } from 'fflate';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { DoctorArchMeta, DoctorMeta } from './format';

declare global {
  interface Window {
    __SMILE_CASE__?: string;
  }
}

type Arch = 'upper' | 'lower';

const CSS = `
:root{--bg:#0b1220;--panel:#111a2c;--line:#24314d;--text:#e6edf7;--muted:#8ea0bf;--accent:#38bdf8;color-scheme:dark;font:14px/1.45 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--text)}
button{font:inherit;color:inherit;background:#16223a;border:1px solid var(--line);border-radius:8px;padding:7px 11px;cursor:pointer}
button.on{background:#0c4a6e;border-color:var(--accent)}button.primary{background:#0ea5e9;border-color:#0ea5e9;color:#031321;font-weight:600}
button.warn{background:#78350f;border-color:#f59e0b}
.app{display:grid;grid-template-columns:1fr 360px;grid-template-rows:auto 1fr;height:100%}
header{grid-column:1/-1;display:flex;gap:12px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);background:#0d1628;flex-wrap:wrap}
header b{font-size:16px}header .muted{color:var(--muted)}
.view{position:relative;min-height:0}.view canvas{display:block;width:100%;height:100%}
.bar{position:absolute;left:10px;right:10px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.bar.top{top:10px}.bar.bottom{bottom:10px;align-items:center;background:#0d1628e6;border:1px solid var(--line);border-radius:12px;padding:8px}
.bar.bottom input{flex:1;min-width:120px;accent-color:var(--accent)}
.stage{min-width:120px;text-align:center;font-variant-numeric:tabular-nums}
aside{border-left:1px solid var(--line);background:var(--panel);overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px}
h3{margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.stats div{background:#16223a;border:1px solid var(--line);border-radius:8px;padding:8px;text-align:center}
.stats b{display:block;font-size:20px}.stats span{font-size:11px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}td,th{padding:4px 3px;border-bottom:1px solid #1d2942;text-align:right}
td:first-child,th:first-child{text-align:left}th{color:var(--muted);font-weight:500}
.actions{display:flex;gap:8px}.actions button{flex:1}
.modal{position:fixed;inset:0;background:#000a;display:none;align-items:center;justify-content:center;padding:16px;z-index:9}
.modal.open{display:flex}.box{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;max-width:520px;width:100%;display:flex;flex-direction:column;gap:10px}
textarea,input[type=text]{width:100%;background:#0a1324;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:8px;font:inherit}
.note{color:var(--muted);font-size:12px}
@media (max-width:820px){.app{grid-template-columns:1fr;grid-template-rows:auto 60vh auto}aside{border-left:0;border-top:1px solid var(--line)}}
`;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const view = <T extends ArrayBufferView>(C: new (b: ArrayBuffer, o: number, l: number) => T, bytes: Uint8Array, size: number): T => {
  const copy = bytes.slice().buffer;
  return new C(copy, 0, bytes.byteLength / size);
};

interface ArchRuntime {
  meta: DoctorArchMeta;
  base: Float32Array;
  index: Uint32Array;
  labels: Uint8Array;
  gv: Uint32Array;
  gt: Uint8Array;
  gw: Float32Array;
  stages: Float32Array;
  toothVerts: Map<number, number[]>;
  mesh: Mesh;
  ghost: Mesh;
  extras: { mesh: Mesh; tooth?: number; stageFrom: number; shifts?: Float32Array }[];
}

function main() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  if (!window.__SMILE_CASE__) {
    document.body.textContent = 'No case data in this file.';
    return;
  }
  const files = unzipSync(b64ToBytes(window.__SMILE_CASE__));
  const meta = JSON.parse(strFromU8(files['meta.json'])) as DoctorMeta;
  const c = meta.caseInfo;
  const total = meta.totalStages;
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  const fmt = (v: number, d = 1) => (Math.abs(v) < 1e-6 ? '·' : v.toFixed(d));
  const moving = meta.teeth.filter((t) => Object.values(t.movement).some((v) => Math.abs(v) > 1e-6));

  document.body.innerHTML = `
  <div class="app">
    <header>
      <b>${esc(meta.lab.name || 'Treatment plan')}</b>
      <span>${esc(c.patientName)}${c.caseId ? ' · ' + esc(c.caseId) : ''}</span>
      <span class="muted">${c.clinician ? 'Dr ' + esc(c.clinician) + ' · ' : ''}${new Date(meta.createdAt).toLocaleDateString()}</span>
    </header>
    <div class="view" id="view">
      <div class="bar top">
        <button data-view="front">Front</button><button data-view="right">Right</button><button data-view="left">Left</button>
        <button data-view="upper">Upper</button><button data-view="lower">Lower</button>
        <button id="tU" class="on">U</button><button id="tL" class="on">L</button><button id="tG">Initial</button>
      </div>
      <div class="bar bottom">
        <button id="play">▶</button>
        <input id="slider" type="range" min="0" max="${total}" step="0.02" value="0">
        <span class="stage" id="label">Initial</span>
        <button id="video" title="Download an MP4 simulation (all views, every aligner)">🎬 Video</button>
      </div>
    </div>
    <aside>
      <div class="stats">
        <div><b>${total}</b><span>aligners</span></div>
        <div><b>${Math.ceil((total * meta.daysPerStage) / 7)}</b><span>weeks</span></div>
        ${meta.mode === 'series' ? `<div><b>${meta.archStages.upper || '–'}/${meta.archStages.lower || '–'}</b><span>upper / lower</span></div>` : `<div><b>${meta.ipr.length}</b><span>IPR contacts</span></div>`}
      </div>
      <div class="actions"><button class="primary" id="approve">✓ Approve</button><button class="warn" id="changes">✎ Request changes</button></div>
      ${meta.doctorNotes ? `<div><h3>Notes from the lab</h3><div style="white-space:pre-wrap">${esc(meta.doctorNotes)}</div></div>` : ''}
      ${
        meta.occlusion.initial
          ? `<div><h3>Occlusion (initial → final)</h3><table>
          ${(['overjetMm', 'overbiteMm', 'midlineMm'] as const)
            .map((k) => `<tr><td>${{ overjetMm: 'Overjet', overbiteMm: 'Overbite', midlineMm: 'Midline' }[k]}</td><td>${meta.occlusion.initial![k].toFixed(1)}${meta.occlusion.final ? ' → ' + meta.occlusion.final[k].toFixed(1) : ''} mm</td></tr>`)
            .join('')}</table></div>`
          : ''
      }
      ${meta.mode === 'series' ? '' : `<div><h3>IPR</h3>${
        meta.ipr.length
          ? `<table><tr><th>Contact</th><th>mm</th><th>Before aligner</th></tr>${meta.ipr
              .slice()
              .sort((a, b) => a.stage - b.stage)
              .map((e) => `<tr><td>${e.contact}</td><td>${e.amountMm.toFixed(2)}</td><td>${e.stage}</td></tr>`)
              .join('')}</table>`
          : '<div class="note">None</div>'
      }</div>`}
      ${meta.mode === 'series' ? '' : `<div><h3>Attachments</h3>${
        meta.teeth.some((t) => t.attachments.length)
          ? `<table>${meta.teeth
              .filter((t) => t.attachments.length)
              .map((t) => `<tr><td>${t.id}</td><td>${t.attachments.join(', ')}</td></tr>`)
              .join('')}</table>`
          : '<div class="note">None</div>'
      }</div>`}
      ${meta.mode === 'series' ? '' : `<div><h3>Tooth movements (final)</h3><table><tr><th>Tooth</th><th title="mesial + / distal −">M/D</th><th title="buccal + / lingual −">B/L</th><th title="extrusion + / intrusion −">E/I</th><th>Tip°</th><th>Torq°</th><th>Rot°</th></tr>
        ${moving
          .map((t) => `<tr><td>${t.id}${t.extracted ? ' (ext.)' : ''}</td><td>${fmt(t.movement.mesial)}</td><td>${fmt(t.movement.buccal)}</td><td>${fmt(t.movement.extrusion)}</td><td>${fmt(t.movement.tip, 0)}</td><td>${fmt(t.movement.torque, 0)}</td><td>${fmt(t.movement.rotation, 0)}</td></tr>`)
          .join('')}</table>
        <div class="note">mm and degrees, in each tooth's own axes.</div></div>`}
      ${meta.planNotes ? `<div><h3>Notes</h3><div>${esc(meta.planNotes)}</div></div>` : ''}
      <div class="note">Simulation for planning purposes. Final tooth positions depend on biological response and patient compliance.</div>
    </aside>
  </div>
  <div class="modal" id="modal"><div class="box">
    <b id="mtitle"></b>
    <input type="text" id="who" placeholder="Your name">
    <textarea id="msg" rows="6" placeholder="Comments (teeth, movements, IPR, attachments…)"></textarea>
    <div class="actions">
      ${meta.lab.email ? '<button id="sendMail" class="primary">Send by email</button>' : ''}
      ${meta.lab.whatsapp ? '<button id="sendWa" class="primary">Send by WhatsApp</button>' : ''}
      <button id="copy">Copy</button><button id="close">Close</button>
    </div>
    <div class="note" id="mnote"></div>
  </div></div>`;

  // ───── 3D
  const host = document.getElementById('view')!;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.prepend(renderer.domElement);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
  scene.add(camera, new AmbientLight(0xffffff, 0.35), new HemisphereLight(0xffffff, 0x8a7f7a, 0.55));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(30, 40, 100);
  camera.add(key);
  const controls = new OrbitControls(camera, renderer.domElement);
  let viewH = 90;
  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h);
    camera.left = (-viewH * w) / h / 2;
    camera.right = (viewH * w) / h / 2;
    camera.top = viewH / 2;
    camera.bottom = -viewH / 2;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);

  const gum = new Color(meta.colors.gum), tooth = new Color(meta.colors.tooth);
  const arches: Partial<Record<Arch, ArchRuntime>> = {};
  for (const arch of ['upper', 'lower'] as Arch[]) {
    const am = meta.arches[arch];
    if (!am) continue;
    const q = view(Int16Array, files[`${arch}.pos`], 2);
    const base = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) base[i] = q[i] * am.scale[i % 3] + am.offset[i % 3];
    const labels = files[`${arch}.lab`];
    const index = view(Uint32Array, files[`${arch}.idx`], 4);
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(base.slice(), 3));
    geom.setIndex(new BufferAttribute(index, 1));
    const col = new Float32Array(base.length);
    for (let i = 0; i < am.vertexCount; i++) {
      const cc = labels[i] && !am.extracted.some((e) => e.id === labels[i]) ? tooth : gum;
      col.set([cc.r, cc.g, cc.b], 3 * i);
    }
    geom.setAttribute('color', new BufferAttribute(col, 3));
    geom.computeVertexNormals();
    const mesh = new Mesh(geom, new MeshStandardMaterial({ vertexColors: true, roughness: 0.52, side: DoubleSide }));
    mesh.frustumCulled = false;
    const gIdx: number[] = [];
    for (let f = 0; f < index.length; f += 3) if (labels[index[f]] && labels[index[f + 1]] && labels[index[f + 2]]) gIdx.push(index[f], index[f + 1], index[f + 2]);
    const gg = new BufferGeometry();
    gg.setAttribute('position', new BufferAttribute(base, 3));
    gg.setIndex(gIdx);
    const ghost = new Mesh(gg, new MeshBasicMaterial({ color: 0x3d8bfd, transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 }));
    ghost.visible = false;
    scene.add(mesh, ghost);
    const toothVerts = new Map<number, number[]>();
    for (let i = 0; i < am.vertexCount; i++) if (labels[i]) (toothVerts.get(labels[i]) ?? toothVerts.set(labels[i], []).get(labels[i])!).push(i);
    const extras: ArchRuntime['extras'] = [];
    const mat = new MeshStandardMaterial({ color: 0x9fd3ff, roughness: 0.35 });
    for (const a of am.attachments) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(view(Float32Array, files[a.file], 4), 3));
      g.computeVertexNormals();
      const m = new Mesh(g, mat);
      m.matrixAutoUpdate = false;
      scene.add(m);
      extras.push({ mesh: m, tooth: a.tooth, stageFrom: a.stageFrom });
    }
    for (const p of am.pontics) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(view(Float32Array, files[p.file], 4), 3));
      g.computeVertexNormals();
      const m = new Mesh(g, new MeshStandardMaterial({ color: tooth, roughness: 0.5 }));
      scene.add(m);
      extras.push({ mesh: m, stageFrom: p.stageFrom, shifts: view(Float32Array, files[`${p.file}.shift`], 4) });
    }
    arches[arch] = {
      meta: am,
      base,
      index,
      labels,
      gv: view(Uint32Array, files[`${arch}.gv`], 4),
      gt: files[`${arch}.gt`],
      gw: view(Float32Array, files[`${arch}.gw`], 4),
      stages: view(Float32Array, files[`${arch}.stages`], 4),
      toothVerts,
      mesh,
      ghost,
      extras,
    };
  }

  // ───── exported stage models (series mode)
  interface SeriesRuntime {
    meta: import('./format').SeriesArchMeta;
    mesh: Mesh;
    ghost: Mesh | null;
    base: Float32Array;
    deltas: Int16Array[];
    meshes: { pos: Float32Array; index: Uint32Array }[];
    shown: number;
  }
  const series: Partial<Record<Arch, SeriesRuntime>> = {};
  for (const arch of ['upper', 'lower'] as Arch[]) {
    const sm = meta.series?.[arch];
    if (!sm) continue;
    const dq = (q: Int16Array) => {
      const p = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) p[i] = q[i] * sm.scale[i % 3] + sm.offset[i % 3];
      return p;
    };
    const stone = new Color('#ece6da');
    const geom = new BufferGeometry();
    let base = new Float32Array(0);
    const deltas: Int16Array[] = [];
    const meshes: SeriesRuntime['meshes'] = [];
    let ghost: Mesh | null = null;
    if (sm.shared) {
      base = dq(view(Int16Array, files[`${arch}.pos0`], 2));
      for (let k = 1; k < sm.stages; k++) deltas.push(view(Int16Array, files[`${arch}.d${k}`], 2));
      const index = view(Uint32Array, files[`${arch}.idx`], 4);
      geom.setAttribute('position', new BufferAttribute(base.slice(), 3));
      geom.setIndex(new BufferAttribute(index, 1));
      const col = new Float32Array(base.length);
      const flags = sm.colored ? files[`${arch}.tooth`] : null;
      for (let i = 0; i < sm.vertexCount; i++) {
        const cc = flags ? (flags[i] ? tooth : gum) : stone;
        col.set([cc.r, cc.g, cc.b], 3 * i);
      }
      geom.setAttribute('color', new BufferAttribute(col, 3));
      if (flags) {
        const gIdx: number[] = [];
        for (let f = 0; f < index.length; f += 3) if (flags[index[f]] && flags[index[f + 1]] && flags[index[f + 2]]) gIdx.push(index[f], index[f + 1], index[f + 2]);
        const gg = new BufferGeometry();
        gg.setAttribute('position', new BufferAttribute(base, 3));
        gg.setIndex(gIdx);
        ghost = new Mesh(gg, new MeshBasicMaterial({ color: 0x3d8bfd, transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 }));
        ghost.visible = false;
        scene.add(ghost);
      }
    } else {
      for (let k = 0; k < sm.stages; k++) meshes.push({ pos: dq(view(Int16Array, files[`${arch}.m${k}.pos`], 2)), index: view(Uint32Array, files[`${arch}.m${k}.idx`], 4) });
      base = meshes[0].pos;
      geom.setAttribute('position', new BufferAttribute(meshes[0].pos, 3));
      geom.setIndex(new BufferAttribute(meshes[0].index, 1));
      const col = new Float32Array(meshes[0].pos.length).fill(0);
      for (let i = 0; i < col.length; i += 3) col.set([stone.r, stone.g, stone.b], i);
      geom.setAttribute('color', new BufferAttribute(col, 3));
    }
    geom.computeVertexNormals();
    const mesh = new Mesh(geom, new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: DoubleSide }));
    mesh.frustumCulled = false;
    scene.add(mesh);
    series[arch] = { meta: sm, mesh, ghost, base, deltas, meshes, shown: 0 };
  }
  const applySeries = (stage: number) => {
    for (const a of Object.values(series)) {
      if (!a) continue;
      const last = a.meta.stages - 1;
      const st = Math.min(stage, last);
      if (a.meta.shared) {
        const pos = (a.mesh.geometry.getAttribute('position') as BufferAttribute).array as Float32Array;
        const s0 = Math.floor(st), s1 = Math.min(last, s0 + 1), f = st - s0;
        const d0 = s0 > 0 ? a.deltas[s0 - 1] : null, d1 = s1 > 0 ? a.deltas[s1 - 1] : null;
        const sc = a.meta.scale;
        for (let i = 0; i < pos.length; i++) {
          const q = (d0 ? d0[i] * (1 - f) : 0) + (d1 ? d1[i] * f : 0);
          pos[i] = a.base[i] + q * sc[i % 3];
        }
        a.mesh.geometry.getAttribute('position').needsUpdate = true;
        a.mesh.geometry.computeVertexNormals();
      } else {
        const k = Math.round(st);
        if (k !== a.shown) {
          const m = a.meshes[k];
          a.mesh.geometry.setAttribute('position', new BufferAttribute(m.pos, 3));
          const col = new Float32Array(m.pos.length);
          const stone = new Color('#ece6da');
          for (let i = 0; i < col.length; i += 3) col.set([stone.r, stone.g, stone.b], i);
          a.mesh.geometry.setAttribute('color', new BufferAttribute(col, 3));
          a.mesh.geometry.setIndex(new BufferAttribute(m.index, 1));
          a.mesh.geometry.computeVertexNormals();
          a.shown = k;
        }
      }
      if (a.ghost) a.ghost.visible = showGhost && a.mesh.visible && stage > 0.01;
    }
  };

  /** Tooth matrices at a (fractional) stage: linear blend between neighbouring stages. */
  const matricesAt = (a: ArchRuntime, stage: number) => {
    const n = a.meta.teeth.length;
    const s0 = Math.floor(stage), s1 = Math.min(total, s0 + 1), f = stage - s0;
    const out = new Map<number, Matrix4>();
    a.meta.teeth.forEach((id, j) => {
      const e0 = a.stages.subarray((s0 * n + j) * 16, (s0 * n + j + 1) * 16);
      const e1 = a.stages.subarray((s1 * n + j) * 16, (s1 * n + j + 1) * 16);
      const e = Array.from(e0, (v, k) => v * (1 - f) + e1[k] * f);
      out.set(id, new Matrix4().fromArray(e));
    });
    return out;
  };

  const v = new Vector3();
  const apply = (stage: number) => {
    applySeries(stage);
    for (const a of Object.values(arches)) {
      if (!a) continue;
      const T = matricesAt(a, stage);
      const pos = (a.mesh.geometry.getAttribute('position') as BufferAttribute).array as Float32Array;
      pos.set(a.base);
      for (const ex of a.meta.extracted) {
        if (stage < ex.fromStage) continue;
        for (const i of a.toothVerts.get(ex.id) ?? []) {
          const d = (pos[3 * i] - ex.point[0]) * ex.normal[0] + (pos[3 * i + 1] - ex.point[1]) * ex.normal[1] + (pos[3 * i + 2] - ex.point[2]) * ex.normal[2];
          for (let k = 0; k < 3; k++) pos[3 * i + k] -= d * ex.normal[k];
        }
      }
      for (const [id, m] of T) {
        for (const i of a.toothVerts.get(id) ?? []) {
          v.fromArray(a.base, 3 * i).applyMatrix4(m);
          pos[3 * i] = v.x;
          pos[3 * i + 1] = v.y;
          pos[3 * i + 2] = v.z;
        }
      }
      for (let k = 0; k < a.gv.length; k++) {
        const m = T.get(a.gt[k]);
        if (!m) continue;
        const i = a.gv[k];
        v.fromArray(a.base, 3 * i).applyMatrix4(m);
        pos[3 * i] += a.gw[k] * (v.x - a.base[3 * i]);
        pos[3 * i + 1] += a.gw[k] * (v.y - a.base[3 * i + 1]);
        pos[3 * i + 2] += a.gw[k] * (v.z - a.base[3 * i + 2]);
      }
      a.mesh.geometry.getAttribute('position').needsUpdate = true;
      a.mesh.geometry.computeVertexNormals();
      for (const x of a.extras) {
        x.mesh.visible = a.mesh.visible && stage >= x.stageFrom;
        if (x.tooth !== undefined) {
          x.mesh.matrix.copy(T.get(x.tooth) ?? new Matrix4());
          x.mesh.matrixWorldNeedsUpdate = true;
        } else if (x.shifts) {
          const s0 = Math.floor(stage), s1 = Math.min(total, s0 + 1), f = stage - s0;
          x.mesh.position.set(...([0, 1, 2].map((k) => x.shifts![3 * s0 + k] * (1 - f) + x.shifts![3 * s1 + k] * f) as [number, number, number]));
        }
      }
      a.ghost.visible = showGhost && a.mesh.visible && stage > 0.01;
    }
    const label = document.getElementById('label')!;
    label.textContent = stage < 0.01 ? 'Initial' : stage > total - 0.01 ? `Final · ${total} aligners` : `Aligner ${Math.ceil(stage)} / ${total}`;
  };

  // views (patient coordinates: +X right, +Y anterior, +Z up)
  const box = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
  for (const a of [...Object.values(arches), ...Object.values(series)]) {
    if (!a) continue;
    for (let i = 0; i < a.base.length; i += 3) {
      box.min.min(v.set(a.base[i], a.base[i + 1], a.base[i + 2]));
      box.max.max(v);
    }
  }
  const center = box.min.clone().add(box.max).multiplyScalar(0.5);
  const size = Math.max(...box.max.clone().sub(box.min).toArray());
  const setView = (name: string) => {
    const dirs: Record<string, [Vector3, Vector3]> = {
      front: [new Vector3(0, 1, 0), new Vector3(0, 0, 1)],
      right: [new Vector3(1, 0, 0), new Vector3(0, 0, 1)],
      left: [new Vector3(-1, 0, 0), new Vector3(0, 0, 1)],
      upper: [new Vector3(0, 0, -1), new Vector3(0, 1, 0)],
      lower: [new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
    };
    const [dir, up] = dirs[name];
    if (name === 'upper' || name === 'lower') setArch(name === 'upper', name === 'lower');
    else setArch(true, true);
    camera.position.copy(center).addScaledVector(dir, 400);
    camera.up.copy(up);
    controls.target.copy(center);
    viewH = size * 1.15;
    camera.zoom = 1;
    resize();
    controls.update();
  };
  let showGhost = false;
  const meshOf = (arch: Arch) => arches[arch]?.mesh ?? series[arch]?.mesh;
  const setArch = (u: boolean, l: boolean) => {
    if (meshOf('upper')) meshOf('upper')!.visible = u;
    if (meshOf('lower')) meshOf('lower')!.visible = l;
    document.getElementById('tU')!.classList.toggle('on', u);
    document.getElementById('tL')!.classList.toggle('on', l);
    apply(stage);
  };
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view!)));
  document.getElementById('tU')!.onclick = () => setArch(!(meshOf('upper')?.visible ?? false), meshOf('lower')?.visible ?? false);
  document.getElementById('tL')!.onclick = () => setArch(meshOf('upper')?.visible ?? false, !(meshOf('lower')?.visible ?? false));
  document.getElementById('tG')!.onclick = (e) => {
    showGhost = !showGhost;
    (e.target as HTMLElement).classList.toggle('on', showGhost);
    apply(stage);
  };

  let stage = 0;
  let playing = false;
  const slider = document.getElementById('slider') as HTMLInputElement;
  slider.oninput = () => {
    stage = +slider.value;
    apply(stage);
  };
  document.getElementById('play')!.onclick = (e) => {
    playing = !playing;
    (e.target as HTMLElement).textContent = playing ? '⏸' : '▶';
    if (playing && stage >= total) stage = 0;
  };
  let last = performance.now();
  const loop = (t: number) => {
    const dt = (t - last) / 1000;
    last = t;
    if (playing && total > 0) {
      stage = Math.min(total, stage + dt * Math.max(2, total / 6));
      slider.value = String(stage);
      apply(stage);
      if (stage >= total) {
        playing = false;
        document.getElementById('play')!.textContent = '▶';
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  setView('front');
  apply(0);
  requestAnimationFrame(loop);

  // ───── MP4 simulation video (front, right, left, upper, lower; every aligner)
  const videoBtn = document.getElementById('video') as HTMLButtonElement;
  if (!('VideoEncoder' in window)) videoBtn.style.display = 'none';
  videoBtn.onclick = async () => {
    const W = 1920, H = 1080, fps = 30, perStage = 0.4, hold = 1;
    const codecs: [string, 'avc' | 'vp9'][] = [['avc1.640034', 'avc'], ['avc1.4d0034', 'avc'], ['avc1.42003e', 'avc'], ['vp09.00.40.08', 'vp9']];
    let picked: { config: VideoEncoderConfig; mux: 'avc' | 'vp9' } | null = null;
    for (const [codec, mux] of codecs) {
      const config: VideoEncoderConfig = { codec, width: W, height: H, bitrate: 8_000_000, framerate: fps, avc: mux === 'avc' ? { format: 'avc' } : undefined };
      try {
        if ((await VideoEncoder.isConfigSupported(config)).supported) {
          picked = { config, mux };
          break;
        }
      } catch {
        /* next */
      }
    }
    if (!picked) return alert('This browser cannot create videos. Use a current Chrome, Edge or Safari.');
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: picked.mux, width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
    const encoder = new VideoEncoder({ output: (chunk, m) => muxer.addVideoChunk(chunk, m), error: (e) => console.error(e) });
    encoder.configure(picked.config);
    const label = document.getElementById('label')!;
    const wasPlaying = playing;
    playing = false;
    const canvas2d = document.createElement('canvas');
    canvas2d.width = W;
    canvas2d.height = H;
    const ctx = canvas2d.getContext('2d')!;
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    const views = ['front', 'right', 'left', 'upper', 'lower'];
    const names: Record<string, string> = { front: 'Frontal', right: 'Right buccal', left: 'Left buccal', upper: 'Upper occlusal', lower: 'Lower occlusal' };
    const holdF = Math.round(hold * fps), moveF = Math.max(1, Math.round(Math.max(1, total) * perStage * fps));
    let frame = 0;
    const totalFrames = views.length * (2 * holdF + moveF);
    for (const vname of views) {
      setView(vname);
      renderer.setSize(W, H, false);
      const h = camera.top - camera.bottom;
      camera.left = (-h * W) / H / 2;
      camera.right = (h * W) / H / 2;
      camera.updateProjectionMatrix();
      for (let f = 0; f < 2 * holdF + moveF; f++) {
        const t = f < holdF ? 0 : f < holdF + moveF ? (f - holdF) / moveF : 1;
        const st = (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2) * total;
        apply(st);
        renderer.render(scene, camera);
        const g = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, W * 0.75);
        g.addColorStop(0, '#1b2a47');
        g.addColorStop(1, '#0b1220');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(renderer.domElement, 0, 0, W, H);
        ctx.fillStyle = '#e6edf7';
        ctx.font = '600 34px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText([meta.lab.name, c.patientName, c.caseId].filter(Boolean).join(' · '), 40, 34);
        ctx.fillStyle = '#8ea0bf';
        ctx.font = '26px Inter, system-ui, sans-serif';
        ctx.fillText(names[vname], 40, 80);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#e6edf7';
        ctx.font = '600 34px Inter, system-ui, sans-serif';
        ctx.fillText(st < 0.01 ? 'Initial' : st > total - 0.01 ? `Final · ${total} aligners` : `Aligner ${Math.ceil(st)} / ${total}`, W - 40, 34);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#24314d';
        ctx.fillRect(40, H - 46, W - 80, 8);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(40, H - 46, (W - 80) * (total ? st / total : 0), 8);
        const vf = new VideoFrame(canvas2d, { timestamp: Math.round((frame * 1e6) / fps), duration: Math.round(1e6 / fps) });
        encoder.encode(vf, { keyFrame: frame % (fps * 2) === 0 });
        vf.close();
        frame++;
        if (frame % 10 === 0) {
          label.textContent = `Video ${Math.round((frame / totalFrames) * 100)}%`;
          await new Promise((r) => setTimeout(r, 0));
          while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
        }
      }
    }
    await encoder.flush();
    muxer.finalize();
    encoder.close();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(c.caseId || c.patientName || 'case').replace(/[^\w-]+/g, '_')}_simulation.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    setView('front');
    apply(stage);
    playing = wasPlaying;
  };

  // ───── approval replies
  const modal = document.getElementById('modal')!;
  let decision = '';
  const message = () => {
    const who = (document.getElementById('who') as HTMLInputElement).value.trim();
    const msg = (document.getElementById('msg') as HTMLTextAreaElement).value.trim();
    return [`${decision} — ${c.caseId || c.patientName}`, `Patient: ${c.patientName}`, `Aligners: ${total}`, who ? `From: ${who}` : '', msg ? `Comments:\n${msg}` : '', `Plan file created ${new Date(meta.createdAt).toLocaleString()}`].filter(Boolean).join('\n');
  };
  const open = (d: string) => {
    decision = d;
    document.getElementById('mtitle')!.textContent = d === 'APPROVED' ? 'Approve this treatment plan' : 'Request changes';
    modal.classList.add('open');
  };
  document.getElementById('approve')!.onclick = () => open('APPROVED');
  document.getElementById('changes')!.onclick = () => open('CHANGES REQUESTED');
  document.getElementById('close')!.onclick = () => modal.classList.remove('open');
  document.getElementById('copy')!.onclick = async () => {
    await navigator.clipboard?.writeText(message());
    document.getElementById('mnote')!.textContent = 'Copied — paste it in your reply to the lab.';
  };
  const mail = document.getElementById('sendMail');
  if (mail) mail.onclick = () => (location.href = `mailto:${encodeURIComponent(meta.lab.email)}?subject=${encodeURIComponent(`${decision}: ${c.caseId || c.patientName}`)}&body=${encodeURIComponent(message())}`);
  const wa = document.getElementById('sendWa');
  if (wa) wa.onclick = () => window.open(`https://wa.me/${meta.lab.whatsapp.replace(/[^\d]/g, '')}?text=${encodeURIComponent(message())}`, '_blank');
}

main();
