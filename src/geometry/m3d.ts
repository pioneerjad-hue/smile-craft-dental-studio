import type { BufferGeometry } from 'three';
import { gunzipSync, unzipSync, unzlibSync } from 'fflate';
import { parseScan } from './io';

/**
 * Best-effort reader for Maestro 3D `.m3d` project files.
 *
 * The format is not publicly documented. Dental project files are commonly containers (zip, gzip or
 * zlib streams) that wrap standard meshes, so this reader searches the file for any STL / PLY / OBJ
 * data: zip entries, compressed streams, and meshes embedded at any offset. When nothing is found it
 * returns a diagnostic fingerprint so support for the real structure can be added from a sample file.
 *
 * Current Maestro projects (checked on a real file) are zip archives whose model entries
 * (*.m3d_mesh) and setup data are encrypted. Those cannot — and must not — be decrypted outside Maestro;
 * the reader then reports `encrypted` and the readable case details, and the user exports STL from
 * Maestro instead.
 */
export interface FoundMesh {
  name: string;
  geometry: BufferGeometry;
  triangles: number;
  hint: 'upper' | 'lower' | null;
}

export interface ProbeResult {
  meshes: FoundMesh[];
  diagnostics: string;
  /** Maestro project whose models are stored encrypted (cannot be read outside Maestro). */
  encrypted: boolean;
  /** Plain-text case details found in the project (info.xml / case.xml). */
  info: { patientName?: string; doctorName?: string; date?: string; teeth?: number[] };
}

const MIN_TRIANGLES = 500; // ignore tiny fragments (icons, attachments, previews)

export function archHint(name: string): 'upper' | 'lower' | null {
  const n = name.toLowerCase();
  if (/(upper|maxil|superior|_sup|oben|^u[._-]|[._-]u[._-]|arcata ?sup)/.test(n)) return 'upper';
  if (/(lower|mandib|inferior|_inf|unten|^l[._-]|[._-]l[._-]|arcata ?inf)/.test(n)) return 'lower';
  return null;
}

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, Math.min(b.length, start + len)));

function tryMesh(bytes: Uint8Array, ext: 'stl' | 'ply' | 'obj', name: string, out: FoundMesh[]) {
  try {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const g = parseScan(buf, `${name}.${ext}`);
    const tris = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
    if (tris >= MIN_TRIANGLES) out.push({ name, geometry: g, triangles: tris, hint: archHint(name) });
  } catch {
    /* not a mesh */
  }
}

/** Recognise a mesh at the start of a byte block. */
function sniffMesh(b: Uint8Array, name: string, out: FoundMesh[]): boolean {
  const head = ascii(b, 0, 6).toLowerCase();
  if (head.startsWith('ply')) return tryMesh(b, 'ply', name, out), true;
  if (b.length >= 84) {
    const count = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true);
    if (84 + 50 * count === b.length && count > 0) return tryMesh(b, 'stl', name, out), true;
  }
  if (head.startsWith('solid') && ascii(b, 0, 2000).includes('facet')) return tryMesh(b, 'stl', name, out), true;
  const text = ascii(b, 0, 4000);
  if (/^v\s+-?\d/m.test(text) && /^(f|vn|vt)\s/m.test(ascii(b, 0, Math.min(b.length, 400000)))) return tryMesh(b, 'obj', name, out), true;
  return false;
}

/** Shannon entropy (bits/byte) of the first 64 KB: ~8.0 means encrypted or compressed data. */
function entropy(b: Uint8Array): number {
  const n = Math.min(b.length, 65536);
  const c = new Uint32Array(256);
  for (let i = 0; i < n; i++) c[b[i]]++;
  let e = 0;
  for (const v of c) if (v) e -= (v / n) * Math.log2(v / n);
  return e;
}

function probe(b: Uint8Array, name: string, out: FoundMesh[], log: string[], depth: number) {
  if (depth > 3 || b.length < 16) return;
  // Maestro mesh entries are encrypted: do not scan them for embedded streams (false positives).
  if (/\.m3d_(mesh|x)$/i.test(name) && entropy(b) > 7.9) {
    log.push(`${name}: encrypted (${b.length} bytes)`);
    return;
  }
  // zip container
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    try {
      const files = unzipSync(b);
      log.push(`${name}: zip with ${Object.keys(files).length} entries (${Object.keys(files).slice(0, 12).join(', ')})`);
      for (const [entry, data] of Object.entries(files)) probe(data, entry, out, log, depth + 1);
      return;
    } catch (e) {
      log.push(`${name}: zip signature but unreadable (${(e as Error).message})`);
    }
  }
  // gzip
  if (b[0] === 0x1f && b[1] === 0x8b) {
    try {
      log.push(`${name}: gzip stream`);
      return probe(gunzipSync(b), name, out, log, depth + 1);
    } catch {
      /* fall through */
    }
  }
  // zlib at the start
  if (b[0] === 0x78 && ((b[0] << 8) | b[1]) % 31 === 0) {
    try {
      const raw = unzlibSync(b);
      log.push(`${name}: zlib stream → ${raw.length} bytes`);
      return probe(raw, name, out, log, depth + 1);
    } catch {
      /* fall through */
    }
  }
  if (sniffMesh(b, name, out)) return;
  // embedded meshes / compressed streams at any offset
  let tried = 0;
  for (let i = 1; i < b.length - 4 && tried < 400; i++) {
    const c = b[i];
    if (c === 0x70 && b[i + 1] === 0x6c && b[i + 2] === 0x79 && (b[i + 3] === 0x0a || b[i + 3] === 0x0d)) {
      tried++;
      log.push(`${name}: embedded PLY header at byte ${i}`);
      tryMesh(b.subarray(i), 'ply', `${name}@${i}`, out);
    } else if (c === 0x78 && (b[i + 1] === 0x9c || b[i + 1] === 0xda || b[i + 1] === 0x01 || b[i + 1] === 0x5e)) {
      tried++;
      try {
        const raw = unzlibSync(b.subarray(i));
        if (raw.length > 4096) {
          log.push(`${name}: zlib stream at byte ${i} → ${raw.length} bytes`);
          const before = out.length;
          probe(raw, `${name}@${i}`, out, log, depth + 1);
          if (out.length > before) i += 1; // keep scanning for more meshes
        }
      } catch {
        /* not a stream */
      }
    }
  }
}

const xmlText = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim() ?? '';

export function readM3d(buffer: ArrayBuffer, fileName: string): ProbeResult {
  const b = new Uint8Array(buffer);
  const log: string[] = [];
  const meshes: FoundMesh[] = [];
  probe(b, fileName.replace(/\.m3d$/i, ''), meshes, log, 0);
  // Plain-text case details and the list of teeth present in the project
  const info: ProbeResult['info'] = {};
  let encrypted = false;
  if (b[0] === 0x50 && b[1] === 0x4b) {
    try {
      const files = unzipSync(b);
      const names = Object.keys(files);
      encrypted = meshes.length === 0 && names.some((n) => /\.m3d_mesh$/i.test(n));
      const dec = new TextDecoder();
      const infoXml = Object.entries(files).find(([n]) => /(^|\/)info\.xml$/i.test(n))?.[1];
      if (infoXml) {
        const x = dec.decode(infoXml);
        info.patientName = [xmlText(x, 'PatientName'), xmlText(x, 'PatientSurname')].filter(Boolean).join(' ') || undefined;
        info.doctorName = [xmlText(x, 'DoctorName'), xmlText(x, 'DoctorSurname')].filter(Boolean).join(' ') || undefined;
      }
      const caseXml = Object.entries(files).find(([n]) => /(^|\/)case\.xml$/i.test(n))?.[1];
      if (caseXml) {
        const x = dec.decode(caseXml);
        const d = xmlText(x, 'Day'), m = xmlText(x, 'Month'), y = xmlText(x, 'Year');
        if (d && m && y) info.date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      const teeth = names.map((n) => n.match(/_tooth_(\d{2})\.m3d_mesh$/i)?.[1]).filter(Boolean).map(Number);
      if (teeth.length) info.teeth = [...new Set(teeth)].sort((p, q) => p - q);
    } catch {
      /* not a readable zip */
    }
  }
  // drop duplicates (same triangle count from the same stream)
  const seen = new Set<string>();
  const unique = meshes.filter((m) => {
    const k = `${m.triangles}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const hex = Array.from(b.subarray(0, 32), (x) => x.toString(16).padStart(2, '0')).join(' ');
  const txt = ascii(b, 0, 32).replace(/[^\x20-\x7e]/g, '.');
  const diagnostics = [`file: ${fileName} (${(b.length / 1048576).toFixed(2)} MB)`, `first bytes: ${hex}`, `as text: ${txt}`, ...log.slice(0, 20)].join('\n');
  return { meshes: unique.sort((a, b2) => b2.triangles - a.triangles), diagnostics, encrypted, info };
}
