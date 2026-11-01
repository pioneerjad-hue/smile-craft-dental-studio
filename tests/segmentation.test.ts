import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { ArchModel, seedRadiusMm } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';
import { computeArchFrames } from '../src/geometry/frames';
import { defaultProtocol } from '../src/core/protocol';
import { parseScan, writeBinaryStl } from '../src/geometry/io';

function seedFor(model: ArchModel, x: number, y: number, top: number) {
  let best = 0, bd = Infinity;
  const v = new Vector3();
  for (let i = 0; i < model.vertexCount; i++) {
    const d = model.position(i, v).distanceToSquared(new Vector3(x, y, top));
    if (d < bd) (bd = d), (best = i);
  }
  return best;
}

function segmentAll(arch: 'upper' | 'lower') {
  const demo = makeDemoArch(arch);
  const stl = writeBinaryStl([{ positions: demo.geometry.getAttribute('position').array, index: demo.geometry.index!.array }]);
  const model = new ArchModel(arch, parseScan(stl.buffer as ArrayBuffer, 'demo.stl'));
  for (const t of demo.teeth) {
    model.addSeed(seedFor(model, t.x, t.y, t.top), t.id);
  }
  model.segment((id) => seedRadiusMm(id));
  return { demo, model };
}

describe('smart segmentation on demo scan', () => {
  const { demo, model } = segmentAll('lower');

  it('round-trips through STL and merges vertices', () => {
    expect(model.vertexCount).toBe(demo.geometry.getAttribute('position').count);
  });

  it('segments every tooth with a plausible crown footprint', () => {
    const teeth = model.teeth().sort();
    expect(teeth.length).toBe(14);
    for (const t of demo.teeth) {
      const stats = model.toothStats(t.id);
      // centroid lies close to the tooth's true centre in the occlusal plane
      expect(Math.hypot(stats.centroid.x - t.x, stats.centroid.y - t.y)).toBeLessThan(1.2);
      // does not leak into gingiva: crown area within sensible bounds (mm²)
      expect(stats.area).toBeGreaterThan(20);
      expect(stats.area).toBeLessThan(260);
    }
  });

  it('computes frames with correct mesial/buccal/occlusal directions', () => {
    const frames = computeArchFrames(model, defaultProtocol());
    // lower arch: occlusal is +z
    expect(frames[31].occlusal[2]).toBeGreaterThan(0.95);
    // 41 (patient right, +x) is mesial toward -x; 31 mesial toward +x
    expect(frames[41].mesial[0]).toBeLessThan(-0.9);
    expect(frames[31].mesial[0]).toBeGreaterThan(0.9);
    // incisors' buccal points anterior (+y), molars' buccal points lateral
    expect(frames[31].buccal[1]).toBeGreaterThan(0.9);
    expect(frames[46].buccal[0]).toBeGreaterThan(0.8);
    expect(frames[36].buccal[0]).toBeLessThan(-0.8);
    // auto width close to the generated width (lower first molar 11.0 mm)
    expect(frames[36].autoWidthMm).toBeGreaterThan(9.5);
    expect(frames[36].autoWidthMm).toBeLessThan(11.6);
  });

  it('upper arch occlusal axis points down toward the lower arch', () => {
    const { model: upper } = segmentAll('upper');
    const frames = computeArchFrames(upper, defaultProtocol());
    expect(frames[11].occlusal[2]).toBeLessThan(-0.95);
    expect(frames[11].buccal[1]).toBeGreaterThan(0.9);
  });
});
