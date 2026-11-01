import { describe, expect, it } from 'vitest';
import { ArchModel, seedRadiusMm } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';
import { autoSeeds } from '../src/geometry/autoSegment';

describe('automatic segmentation', () => {
  for (const arch of ['upper', 'lower'] as const) {
    it(`finds and numbers every ${arch} tooth`, () => {
      const demo = makeDemoArch(arch);
      const model = new ArchModel(arch, demo.geometry);
      const present = demo.teeth.map((t) => t.id);
      const seeds = autoSeeds(model, arch, present);
      expect(seeds.length).toBe(present.length);
      for (const s of seeds) model.addSeed(s.v, s.tooth);
      model.segment((id) => seedRadiusMm(id));
      let wrong = 0;
      for (const t of demo.teeth) {
        const c = model.toothStats(t.id).centroid;
        if (Math.hypot(c.x - t.x, c.y - t.y) > 1.5) wrong++;
      }
      expect(wrong).toBe(0);
    });
  }

  it('respects missing teeth', () => {
    const demo = makeDemoArch('lower');
    const model = new ArchModel('lower', demo.geometry);
    const seeds = autoSeeds(model, 'lower', demo.teeth.map((t) => t.id).filter((id) => id !== 37 && id !== 47));
    expect(seeds.map((s) => s.tooth)).not.toContain(37);
    expect(seeds.length).toBe(12);
  });
});
