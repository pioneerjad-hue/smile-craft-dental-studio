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

describe('encrypted Maestro projects', () => {
  it('recognises encrypted mesh entries and reads the plain case details', () => {
    let seed = 1;
    const noise = (n: number) => new Uint8Array(n).map(() => ((seed = (seed * 16807) % 2147483647) & 255));
    const file = zipSync({
      'case.xml': strToU8('<CASE><Date><Day>3</Day><Month>4</Month><Year>2026</Year></Date></CASE>'),
      'info.xml': strToU8('<UserProfile><PatientName>Test</PatientName><PatientSurname>Patient</PatientSurname><DoctorName>Jo</DoctorName><DoctorSurname>Doe</DoctorSurname></UserProfile>'),
      'lowerjaw.m3d_mesh': noise(70000),
      'setup/lower/lowerjaw_tooth_31.m3d_mesh': noise(4096),
      'setup/lower/lowerjaw_tooth_41.m3d_mesh': noise(4096),
    });
    const r = readM3d(file.buffer as ArrayBuffer, 'x.m3d');
    expect(r.meshes.length).toBe(0);
    expect(r.encrypted).toBe(true);
    expect(r.info).toEqual({ patientName: 'Test Patient', doctorName: 'Jo Doe', date: '2026-04-03', teeth: [31, 41] });
  });
});
