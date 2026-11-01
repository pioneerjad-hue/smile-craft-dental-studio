import { describe, expect, it } from 'vitest';
import { ArchModel, seedRadiusMm } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';
import { autoSegmentSeeds } from '../src/geometry/autoSegment';
import { gumDistanceToTeeth, trimLine } from '../src/geometry/trimLine';

describe('aligner trim line', () => {
  it('runs around the whole arch at the requested distance from the teeth', () => {
    const demo = makeDemoArch('lower');
    const model = new ArchModel('lower', demo.geometry);
    const { teeth, gum } = autoSegmentSeeds(model, 'lower', demo.teeth.map((t) => t.id));
    for (const s of teeth) model.addSeed(s.v, s.tooth);
    model.paintVertices(gum, 0);
    model.segment((id) => seedRadiusMm(id));
    const dist = gumDistanceToTeeth(model);
    const line = trimLine(model, dist, model.base, 1.5);
    let length = 0;
    for (let i = 1; i < line.length; i++) length += line[i].distanceTo(line[i - 1]);
    // goes buccal and lingual around ~120 mm of arch: well over 150 mm long
    expect(length).toBeGreaterThan(150);
    // every point sits 1–2.2 mm from the nearest tooth vertex (smoothing pulls it slightly)
    const toothVerts: number[] = [];
    for (let i = 0; i < model.vertexCount; i++) if (model.labels[i]) toothVerts.push(i);
    for (const p of line.filter((_, i) => i % 25 === 0)) {
      let d = Infinity;
      for (const v of toothVerts) d = Math.min(d, Math.hypot(model.base[3 * v] - p.x, model.base[3 * v + 1] - p.y, model.base[3 * v + 2] - p.z));
      expect(d).toBeGreaterThan(0.8);
      expect(d).toBeLessThan(2.2);
    }
  });
});
