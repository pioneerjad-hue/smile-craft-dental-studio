import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { ArchModel } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';
import { boundaryLoops, buildModelBase, openEdgeCount } from '../src/geometry/modelBase';

describe('model builder', () => {
  for (const arch of ['upper', 'lower'] as const) {
    it(`closes the ${arch} scan into a watertight, consistently wound solid`, () => {
      const model = new ArchModel(arch, makeDemoArch(arch).geometry);
      expect(boundaryLoops(model.index, model.vertexCount).length).toBe(1);
      expect(openEdgeCount(model.index, model.vertexCount)).toBeGreaterThan(0);
      const O = new Vector3(0, 0, arch === 'lower' ? 1 : -1);
      const base = buildModelBase(model, O, { thicknessMm: 3 })!;
      const index = new Uint32Array(model.index.length + base.index.length);
      index.set(model.index);
      index.set(base.index, model.index.length);
      const total = model.vertexCount + base.positions.length / 3;
      expect(openEdgeCount(index, total)).toBe(0);
      // consistent winding: every directed edge appears once (each undirected edge in both directions)
      const seen = new Set<number>();
      let duplicates = 0;
      for (let f = 0; f < index.length; f += 3) {
        for (let k = 0; k < 3; k++) {
          const key = index[f + k] * total + index[f + ((k + 1) % 3)];
          if (seen.has(key)) duplicates++;
          seen.add(key);
        }
      }
      expect(duplicates).toBe(0);
      // base plane lies 3 mm beyond the most apical scan point
      let minH = Infinity;
      for (let i = 0; i < model.vertexCount; i++) minH = Math.min(minH, model.position(i).dot(O));
      const h = new Vector3().fromArray(base.positions, 0).dot(O);
      expect(h).toBeCloseTo(minH - 3, 4);
    });
  }
});

describe('engraved stage label', () => {
  for (const arch of ['upper', 'lower'] as const) {
    it(`engraves "SC-0142 ${arch === 'upper' ? 'U' : 'L'}07" into the ${arch} base and stays watertight`, () => {
      const model = new ArchModel(arch, makeDemoArch(arch).geometry);
      const O = new Vector3(0, 0, arch === 'lower' ? 1 : -1);
      const base = buildModelBase(model, O, { thicknessMm: 3, label: `SC-0142 ${arch === 'upper' ? 'U' : 'L'}07` })!;
      expect(base.labelPlaced).toBe(true);
      const total = model.vertexCount + base.positions.length / 3;
      const index = new Uint32Array(model.index.length + base.index.length);
      index.set(model.index);
      index.set(base.index, model.index.length);
      expect(openEdgeCount(index, total)).toBe(0);
      const seen = new Set<number>();
      let duplicates = 0;
      for (let f = 0; f < index.length; f += 3) {
        for (let k = 0; k < 3; k++) {
          const key = index[f + k] * total + index[f + ((k + 1) % 3)];
          if (seen.has(key)) duplicates++;
          seen.add(key);
        }
      }
      expect(duplicates).toBe(0);
    }, 30000);
  }
});
