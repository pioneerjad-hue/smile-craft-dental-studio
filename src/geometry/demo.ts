import { BufferAttribute, BufferGeometry } from 'three';
import type { Arch } from '../core/fdi';
import { toothNumber } from '../core/fdi';

/**
 * Procedural demo arches (heightfield "scans") with mild crowding, rotations and a high canine,
 * so the whole workflow can be tried without patient data. Units: mm. Patient right = +x,
 * anterior = +y, up = +z.
 */
interface DemoTooth {
  id: number;
  cx: number;
  cy: number;
  angle: number;
  a: number;
  b: number;
  top: number;
}

const WIDTH: Record<Arch, number[]> = {
  upper: [8.6, 6.6, 7.6, 7.0, 6.6, 10.2, 9.2],
  lower: [5.4, 5.9, 6.8, 7.0, 7.2, 11.0, 10.4],
};
const BL: Record<Arch, number[]> = {
  upper: [3.6, 3.3, 4.2, 4.6, 4.6, 5.4, 5.2],
  lower: [3.0, 3.1, 3.8, 4.0, 4.2, 5.0, 4.9],
};
const HEIGHT = [10.2, 9.8, 11, 9.4, 9.2, 8.6, 8.4];

/** Malocclusion: [buccal mm, along-arch mm, rotation deg, vertical mm]. */
const OFFSETS: Record<number, [number, number, number, number]> = {
  11: [0.3, 0, 6, 0],
  12: [-1.4, 0, 12, -0.4],
  22: [-1.0, 0, -14, 0],
  13: [1.1, 0, 0, -1.2],
  41: [1.1, 0, 0, 0.3],
  42: [0, 0, 16, 0],
  32: [-0.8, 0, 0, 0],
  33: [0, 0, -12, 0],
};

function archCurve(arch: Arch) {
  const front = arch === 'upper' ? 27 : 24.5;
  const k = arch === 'upper' ? 0.043 : 0.05;
  const pts: [number, number][] = [];
  for (let x = -38; x <= 38.001; x += 0.1) pts.push([x, front - k * x * x]);
  return pts;
}

function placeTeeth(arch: Arch): DemoTooth[] {
  const curve = archCurve(arch);
  // cumulative arc length from midline
  const mid = Math.floor(curve.length / 2);
  const arc: number[] = new Array(curve.length).fill(0);
  for (let i = mid + 1; i < curve.length; i++) arc[i] = arc[i - 1] + Math.hypot(curve[i][0] - curve[i - 1][0], curve[i][1] - curve[i - 1][1]);
  for (let i = mid - 1; i >= 0; i--) arc[i] = arc[i + 1] - Math.hypot(curve[i][0] - curve[i + 1][0], curve[i][1] - curve[i + 1][1]);
  const at = (s: number) => {
    let best = 0;
    for (let i = 0; i < curve.length; i++) if (Math.abs(arc[i] - s) < Math.abs(arc[best] - s)) best = i;
    const i0 = Math.max(0, best - 1), i1 = Math.min(curve.length - 1, best + 1);
    const tx = curve[i1][0] - curve[i0][0], ty = curve[i1][1] - curve[i0][1];
    return { x: curve[best][0], y: curve[best][1], angle: Math.atan2(ty, tx) };
  };
  const teeth: DemoTooth[] = [];
  const quadrants: [number, number][] = arch === 'upper' ? [[1, 1], [2, -1]] : [[4, 1], [3, -1]];
  for (const [q, side] of quadrants) {
    let s = 0;
    for (let n = 1; n <= 7; n++) {
      const w = WIDTH[arch][n - 1];
      const center = s + w / 2;
      s += w * 0.96; // slight crowding: contacts overlap
      const id = q * 10 + n;
      const [db, ds, rot, dz] = OFFSETS[id] ?? [0, 0, 0, 0];
      const p = at(side * (center + ds));
      // outward normal of the arch at p (curve opens toward -y)
      let nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
      if (nx * p.x + ny * (p.y - 5) < 0) (nx = -nx), (ny = -ny);
      teeth.push({
        id,
        cx: p.x + nx * db,
        cy: p.y + ny * db,
        angle: p.angle + (rot * Math.PI) / 180,
        a: w / 2,
        b: BL[arch][n - 1],
        top: 3 + HEIGHT[n - 1] + dz,
      });
    }
  }
  return teeth;
}

function heightAt(x: number, y: number, curve: [number, number][], teeth: DemoTooth[]) {
  let d2 = Infinity;
  for (const [cx, cy] of curve) {
    const dd = (x - cx) ** 2 + (y - cy) ** 2;
    if (dd < d2) d2 = dd;
  }
  const d = Math.sqrt(d2);
  // Alveolar ridge: convex over the roots (like attached gingiva), meeting the flat vestibule
  // floor in a concave fold about 9 mm from the tooth row.
  let z = d < 9 ? 2 + 5 * (1 - (d / 9) ** 2) : 2;
  for (const t of teeth) {
    const dx = x - t.cx, dy = y - t.cy;
    if (dx * dx + dy * dy > 64) continue;
    const c = Math.cos(t.angle), s = Math.sin(t.angle);
    const u = (dx * c + dy * s) / t.a;
    const v = (-dx * s + dy * c) / t.b;
    const r4 = u ** 4 + v ** 4;
    if (r4 >= 1) continue;
    let zt = 3 + (t.top - 3) * Math.pow(1 - r4, 0.3);
    const n = toothNumber(t.id);
    if (n >= 4) zt -= 0.9 * Math.exp(-(((v * t.b) / 0.8) ** 2)) * (1 - Math.sqrt(r4)); // central fissure
    z = Math.max(z, zt);
  }
  return { z, d };
}

export interface DemoArch {
  geometry: BufferGeometry;
  teeth: { id: number; x: number; y: number; top: number }[];
}

export function makeDemoArch(arch: Arch, step = 0.2, noiseMm = 0): DemoArch {
  let seed = arch === 'upper' ? 7 : 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const curve = archCurve(arch);
  const teeth = placeTeeth(arch);
  const x0 = -37, x1 = 37;
  const y0 = arch === 'upper' ? -26 : -21, y1 = arch === 'upper' ? 36 : 33;
  const nx = Math.round((x1 - x0) / step) + 1;
  const ny = Math.round((y1 - y0) / step) + 1;
  const z = new Float32Array(nx * ny);
  const dist = new Float32Array(nx * ny);
  // coarse curve for distance queries
  const coarse = curve.filter((_, i) => i % 3 === 0);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const h = heightAt(x0 + i * step, y0 + j * step, coarse, teeth);
      z[j * nx + i] = h.z;
      dist[j * nx + i] = h.d;
    }
  }
  const keep = (k: number) => dist[k] < 11;
  const remap = new Int32Array(nx * ny).fill(-1);
  const pos: number[] = [];
  const index: number[] = [];
  const vid = (i: number, j: number) => {
    const k = j * nx + i;
    if (remap[k] < 0) {
      remap[k] = pos.length / 3;
      const h = z[k] + (noiseMm ? noiseMm * rand() : 0);
      if (arch === 'lower') pos.push(x0 + i * step, y0 + j * step, h);
      else pos.push(x0 + i * step, y0 + j * step, 28.5 - h);
    }
    return remap[k];
  };
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const k00 = j * nx + i, k10 = k00 + 1, k01 = k00 + nx, k11 = k01 + 1;
      if (!(keep(k00) && keep(k10) && keep(k01) && keep(k11))) continue;
      const a = vid(i, j), b = vid(i + 1, j), c = vid(i, j + 1), d = vid(i + 1, j + 1);
      if (arch === 'lower') index.push(a, b, d, a, d, c);
      else index.push(a, d, b, a, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(index);
  return {
    geometry: g,
    teeth: teeth.map((t) => ({ id: t.id, x: t.cx, y: t.cy, top: arch === 'lower' ? t.top : 28.5 - t.top })),
  };
}
