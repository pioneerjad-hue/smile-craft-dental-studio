import { BufferAttribute, BufferGeometry } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Mesh } from 'three';

export const SCAN_EXTENSIONS = ['stl', 'ply', 'obj'];

export function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** Parse an intraoral scan (STL ascii/binary, PLY, OBJ) into a position-only geometry in mm. */
export function parseScan(buffer: ArrayBuffer, fileName: string): BufferGeometry {
  const ext = extensionOf(fileName);
  let g: BufferGeometry;
  if (ext === 'stl') g = new STLLoader().parse(buffer);
  else if (ext === 'ply') g = new PLYLoader().parse(buffer);
  else if (ext === 'obj') {
    const group = new OBJLoader().parse(new TextDecoder().decode(buffer));
    const parts: BufferGeometry[] = [];
    group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        const pg = new BufferGeometry();
        pg.setAttribute('position', mesh.geometry.getAttribute('position'));
        if (mesh.geometry.index) pg.setIndex(mesh.geometry.index);
        parts.push(pg.index ? pg.toNonIndexed() : pg);
      }
    });
    if (!parts.length) throw new Error('OBJ file contains no meshes');
    g = mergeGeometries(parts)!;
  } else throw new Error(`Unsupported scan format ".${ext}" — use STL, PLY or OBJ.`);
  const pos = g.getAttribute('position');
  if (!pos || pos.count < 3) throw new Error('The scan file contains no triangles.');
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(pos.array as ArrayLike<number>), 3));
  if (g.index) out.setIndex(new BufferAttribute(new Uint32Array(g.index.array as ArrayLike<number>), 1));
  return out;
}

/** Binary STL writer for indexed or non-indexed triangle soups given as flat arrays. */
export function writeBinaryStl(parts: { positions: ArrayLike<number>; index?: ArrayLike<number> }[], header = 'Smile Craft Dental Studio'): Uint8Array {
  let triangles = 0;
  for (const p of parts) triangles += (p.index ? p.index.length : p.positions.length / 3) / 3;
  const buffer = new ArrayBuffer(84 + 50 * triangles);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const head = new TextEncoder().encode(header.slice(0, 79));
  bytes.set(head, 0);
  view.setUint32(80, triangles, true);
  let o = 84;
  for (const { positions: P, index: I } of parts) {
    const tri = (I ? I.length : P.length / 3) / 3;
    for (let t = 0; t < tri; t++) {
      const ia = I ? I[3 * t] : 3 * t, ib = I ? I[3 * t + 1] : 3 * t + 1, ic = I ? I[3 * t + 2] : 3 * t + 2;
      const ax = P[3 * ia], ay = P[3 * ia + 1], az = P[3 * ia + 2];
      const bx = P[3 * ib], by = P[3 * ib + 1], bz = P[3 * ib + 2];
      const cx = P[3 * ic], cy = P[3 * ic + 1], cz = P[3 * ic + 2];
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len, ny /= len, nz /= len;
      for (const val of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
        view.setFloat32(o, val, true);
        o += 4;
      }
      view.setUint16(o, 0, true);
      o += 2;
    }
  }
  return bytes;
}
