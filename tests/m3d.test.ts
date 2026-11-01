import { describe, expect, it } from 'vitest';
import { zipSync, zlibSync, strToU8 } from 'fflate';
import { makeDemoArch } from '../src/geometry/demo';
import { writeBinaryStl } from '../src/geometry/io';
import { readM3d } from '../src/geometry/m3d';

const stl = (arch: 'upper' | 'lower') => {
  const g = makeDemoArch(arch).geometry;
  return writeBinaryStl([{ positions: g.getAttribute('position').array, index: g.index!.array }]);
};

describe('.m3d reader (container probing)', () => {
  it('reads meshes stored as zip entries and assigns arches by name', () => {
    const file = zipSync({ 'case.xml': strToU8('<case/>'), 'models/UpperJaw.stl': stl('upper'), 'models/LowerJaw.stl': stl('lower') });
    const r = readM3d(file.buffer as ArrayBuffer, 'patient.m3d');
    expect(r.meshes.length).toBe(2);
    expect(r.meshes.map((m) => m.hint).sort()).toEqual(['lower', 'upper']);
  });

  it('finds zlib-compressed meshes embedded after a proprietary header', () => {
    const header = new Uint8Array(1200).map((_, i) => (i * 37) % 251);
    const a = zlibSync(stl('upper'));
    const b = zlibSync(stl('lower'));
    const file = new Uint8Array(header.length + a.length + 64 + b.length);
    file.set(header);
    file.set(a, header.length);
    file.set(b, header.length + a.length + 64);
    const r = readM3d(file.buffer as ArrayBuffer, 'case.m3d');
    expect(r.meshes.length).toBe(2);
  });

  it('reports a fingerprint when nothing is recognised', () => {
    const r = readM3d(new Uint8Array(5000).fill(7).buffer as ArrayBuffer, 'unknown.m3d');
    expect(r.meshes.length).toBe(0);
    expect(r.diagnostics).toContain('first bytes: 07 07');
  });
});
