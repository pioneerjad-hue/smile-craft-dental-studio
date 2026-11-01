import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import type { Arch } from '../core/fdi';
import { normalizeProtocol } from '../core/protocol';
import { extensionOf } from '../geometry/io';
import { getState, setState, toast } from './store';
import { studio } from './studio';

const FORMAT = 'smile-craft/project@1';

/** Serialize the full case (scans, segmentation, plan, protocol) into one .smile file (zip). */
export function buildProjectZip(): Uint8Array {
  const s = getState();
  const files: Zippable = {};
  const arches: Record<string, { file: string; fileName: string }> = {};
  for (const arch of ['upper', 'lower'] as Arch[]) {
    const raw = studio.raw[arch];
    const m = studio.models[arch];
    if (!raw || !m) continue;
    const file = `${arch}.${extensionOf(raw.fileName) || 'stl'}`;
    files[file] = [new Uint8Array(raw.buffer), { level: 1 }];
    files[`${arch}.labels`] = new Uint8Array(m.labels);
    files[`${arch}.paint`] = new Uint8Array(m.paint);
    files[`${arch}.seeds.json`] = strToU8(JSON.stringify(m.seeds));
    arches[arch] = { file, fileName: raw.fileName };
  }
  const json = {
    format: FORMAT,
    savedAt: new Date().toISOString(),
    caseInfo: s.caseInfo,
    plan: s.plan,
    protocol: s.protocol,
    measurements: s.measurements,
    settings: s.settings,
    arches,
  };
  files['case.json'] = strToU8(JSON.stringify(json, null, 2));
  return zipSync(files, { level: 6 });
}

export function loadProjectZip(data: Uint8Array) {
  const files = unzipSync(data);
  if (!files['case.json']) throw new Error('Not a Smile Craft project (case.json missing).');
  const json = JSON.parse(strFromU8(files['case.json']));
  if (json.format !== FORMAT) throw new Error(`Unsupported project format ${json.format}`);
  studio.resetCase();
  setState({
    caseInfo: json.caseInfo,
    protocol: normalizeProtocol(json.protocol),
    settings: { ...getState().settings, ...json.settings },
    measurements: json.measurements ?? [],
  });
  for (const arch of ['upper', 'lower'] as Arch[]) {
    const a = json.arches?.[arch];
    if (!a || !files[a.file]) continue;
    const bytes = files[a.file];
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    studio.loadScanBuffer(arch, buffer, a.fileName, {
      labels: files[`${arch}.labels`],
      paint: files[`${arch}.paint`],
      seeds: files[`${arch}.seeds.json`] ? JSON.parse(strFromU8(files[`${arch}.seeds.json`])) : [],
    });
  }
  // Restore the plan after frames were computed so saved movements are kept.
  studio.recomputeFrames();
  const plan = json.plan;
  const current = getState().plan;
  for (const id of Object.keys(current.teeth)) if (plan.teeth[id]) current.teeth[+id] = plan.teeth[id];
  setState({ plan: { ...current, ipr: plan.ipr ?? [], notes: plan.notes ?? '' }, step: getState().teeth.length ? 'plan' : 'segment' });
}

export function download(data: Uint8Array | string, fileName: string, mime = 'application/octet-stream') {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function safeName(s: string, fallback = 'case') {
  const v = s.trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
  return v || fallback;
}

export function saveProject() {
  const s = getState();
  if (!studio.models.upper && !studio.models.lower) return toast('Nothing to save yet — import scans first.', 'error');
  const zip = buildProjectZip();
  download(zip, `${safeName(s.caseInfo.caseId || s.caseInfo.patientName)}.smile`);
  toast('Project saved.', 'success');
}

// ───────────── autosave (IndexedDB, this browser only) ─────────────
const DB = 'smile-craft';
const STORE = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function writeAutosave() {
  try {
    if (!studio.models.upper && !studio.models.lower) return;
    const zip = buildProjectZip();
    const db = await openDb();
    const s = getState();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ zip, savedAt: new Date().toISOString(), label: s.caseInfo.caseId || s.caseInfo.patientName || 'Untitled case' }, 'last');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* autosave is best effort */
  }
}

export async function readAutosave(): Promise<{ zip: Uint8Array; savedAt: string; label: string } | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get('last');
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

let autosaveTimer: number | null = null;
export function scheduleAutosave() {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    void writeAutosave();
  }, 4000);
}
