import { describe, expect, it } from 'vitest';
import { Matrix4 } from 'three';
import { ArchModel, seedRadiusMm } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';
import { autoSegmentSeeds } from '../src/geometry/autoSegment';
import { occlusionMetrics } from '../src/geometry/occlusion';

function segmented(arch: 'upper' | 'lower') {
  const demo = makeDemoArch(arch);
  const m = new ArchModel(arch, demo.geometry);
  const { teeth, gum } = autoSegmentSeeds(m, arch, demo.teeth.map((t) => t.id));
  for (const s of teeth) m.addSeed(s.v, s.tooth);
  m.paintVertices(gum, 0);
  m.segment((id) => seedRadiusMm(id));
  return { m, demo };
}

describe('occlusion metrics', () => {
  const U = segmented('upper');
  const L = segmented('lower');
  it('measures overbite from the incisal edges', () => {
    const o = occlusionMetrics(U.m, U.m.base, L.m, L.m.base)!;
    // demo: upper central tips at z = 28.5 − 13.2 = 15.3, lower 41 tip at 13.5 → 1.8 mm open bite
    expect(o.overbiteMm).toBeCloseTo(-1.8, 0);
  });
  it('responds to intrusion and midline shifts', () => {
    const before = occlusionMetrics(U.m, U.m.base, L.m, L.m.base)!;
    const T = new Map([
      [31, new Matrix4().makeTranslation(1, 0, 1)],
      [41, new Matrix4().makeTranslation(1, 0, 1)],
    ]);
    const lowerPos = L.m.deformedPositions(T);
    const after = occlusionMetrics(U.m, U.m.base, L.m, lowerPos)!;
    expect(after.overbiteMm - before.overbiteMm).toBeCloseTo(1, 1);
    expect(after.midlineMm - before.midlineMm).toBeCloseTo(-1, 1);
  });
});
