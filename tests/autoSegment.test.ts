import { describe, expect, it } from 'vitest';
import { ArchModel, seedRadiusMm } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';
import { autoSeeds, autoSegmentSeeds } from '../src/geometry/autoSegment';

describe('automatic segmentation', () => {
  for (const arch of ['upper', 'lower'] as const) {
    it(`finds and numbers every ${arch} tooth`, () => {
      const demo = makeDemoArch(arch);
      const model = new ArchModel(arch, demo.geometry);
      const present = demo.teeth.map((t) => t.id);
      const { teeth: seeds, gum } = autoSegmentSeeds(model, arch, present);
      expect(new Set(seeds.map((s) => s.tooth)).size).toBe(present.length);
      for (const s of seeds) model.addSeed(s.v, s.tooth);
      model.paintVertices(gum, 0);
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
    expect(new Set(seeds.map((s) => s.tooth)).size).toBe(12);
  });
});

import { Vector3 } from 'three';
import { crownHeightLimitMm } from '../src/geometry/archModel';

describe('automatic segmentation on a scanner-like mesh', () => {
  for (const arch of ['upper', 'lower'] as const) {
    it(`segments a fine, noisy ${arch} scan without leaking into the gum`, () => {
      // 0.12 mm vertex spacing with ±0.03 mm noise: ~3x denser than the demo, like intraoral scans
      const demo = makeDemoArch(arch, 0.12, 0.03);
      const model = new ArchModel(arch, demo.geometry);
      const { teeth: seeds, gum } = autoSegmentSeeds(model, arch, demo.teeth.map((t) => t.id));
      for (const s of seeds) model.addSeed(s.v, s.tooth);
      model.paintVertices(gum, 0);
      const up = new Vector3(0, 0, arch === 'lower' ? 1 : -1);
      model.segment((id) => seedRadiusMm(id), 0, { up, limitFor: crownHeightLimitMm });
      let wrong = 0;
      for (const t of demo.teeth) {
        const st = model.toothStats(t.id);
        if (Math.hypot(st.centroid.x - t.x, st.centroid.y - t.y) > 1.2) wrong++;
        // crown never extends deeper than the gum base plane of the demo (z = 2 lower / 26.5 upper)
        let deepest = Infinity;
        for (const v of st.vertices) deepest = Math.min(deepest, model.position(v).dot(up) * 1);
        const baseLevel = arch === 'lower' ? 2.5 : -26;
        expect(deepest).toBeGreaterThan(baseLevel);
      }
      expect(wrong).toBe(0);
    }, 60000);
  }
});
