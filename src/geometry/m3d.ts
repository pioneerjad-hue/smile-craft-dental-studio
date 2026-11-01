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

function probe(b: Uint8Array, name: string, out: FoundMesh[], log: string[], depth: number) {
  if (depth > 3 || b.length < 16) return;
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

export function readM3d(buffer: ArrayBuffer, fileName: string): ProbeResult {
  const b = new Uint8Array(buffer);
  const log: string[] = [];
  const meshes: FoundMesh[] = [];
  probe(b, fileName.replace(/\.m3d$/i, ''), meshes, log, 0);
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
  return { meshes: unique.sort((a, b2) => b2.triangles - a.triangles), diagnostics };
}
