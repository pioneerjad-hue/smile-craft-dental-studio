import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { ArchModel } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';
import { buildModelBase } from '../src/geometry/modelBase';
import { biteTransforms } from '../src/geometry/bite';
import type { MeshData } from '../src/geometry/bite';

/** Demo arch in demo (occlusion) coordinates; optionally closed with a printable base. */
function arch(a: 'upper' | 'lower', closed: boolean): MeshData {
  const m = new ArchModel(a, makeDemoArch(a).geometry);
  if (!closed) return { positions: m.base.slice(), index: m.index.slice() };
  const b = buildModelBase(m, new Vector3(0, 0, a === 'lower' ? 1 : -1), { thicknessMm: 4 })!;
  const positions = new Float32Array(m.base.length + b.positions.length);
  positions.set(m.base);
  positions.set(b.positions, m.base.length);
  const index = new Uint32Array(m.index.length + b.index.length);
  index.set(m.index);
  index.set(b.index, m.index.length);
  return { positions, index };
}
const moved = (d: MeshData, T: Matrix4): MeshData => {
  const p = d.positions.slice();
  const v = new Vector3();
  for (let i = 0; i < p.length; i += 3) {
    v.fromArray(p, i).applyMatrix4(T);
    p[i] = v.x, p[i + 1] = v.y, p[i + 2] = v.z;
  }
  return { positions: p, index: d.index };
};
/** Residual of the reconstructed upper-to-lower relation vs the true one (demo coordinates). */
function relativeError(Ru: Matrix4, Tu: Matrix4, Rl: Matrix4, Tl: Matrix4) {
  const rel = Rl.clone().multiply(Tl).invert().multiply(Ru.clone().multiply(Tu)); // ≈ identity
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(rel));
  const angle = (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180) / Math.PI;
  const p = new Vector3(0, 20, 15); // near the upper incisors
  return { angle, mm: p.clone().applyMatrix4(rel).distanceTo(p) };
}

describe('bite of exported stage models', () => {
  const Tu = new Matrix4().makeRotationFromEuler(new Euler(Math.PI, 0.3, 0.9)).setPosition(60, -20, 5); // upper flipped teeth-up
  const Tl = new Matrix4().makeRotationFromEuler(new Euler(0.2, -0.1, -1.4)).setPosition(-40, 30, 0);
  const U = arch('upper', true), L = arch('lower', true);

  it('keeps exports that are already in occlusion', () => {
    const T = new Matrix4().makeRotationFromEuler(new Euler(0.3, 0.5, -0.8)).setPosition(5, 9, -3);
    const r = biteTransforms({ upper: moved(U, T), lower: moved(L, T) }, {});
    expect(r.source).toBe('export');
    const e = relativeError(r.transforms.upper!, T, r.transforms.lower!, T);
    expect(e.mm).toBeLessThan(0.01);
  }, 60000);

  it('restores the real bite from the initial scans', () => {
    const r = biteTransforms({ upper: moved(U, Tu), lower: moved(L, Tl) }, { upper: arch('upper', false), lower: arch('lower', false) });
    expect(r.source).toBe('scans');
    const e = relativeError(r.transforms.upper!, Tu, r.transforms.lower!, Tl);
    expect(e.mm).toBeLessThan(0.3);
    expect(e.angle).toBeLessThan(0.5);
  }, 60000);

  it('builds an approximate bite when arches come separately (closed bases, printing orientation)', () => {
    const r = biteTransforms({ upper: moved(U, Tu), lower: moved(L, Tl) }, {});
    expect(r.source).toBe('estimated');
    const e = relativeError(r.transforms.upper!, Tu, r.transforms.lower!, Tl);
    expect(e.angle).toBeLessThan(4);
    expect(e.mm).toBeLessThan(4);
  }, 60000);
});
