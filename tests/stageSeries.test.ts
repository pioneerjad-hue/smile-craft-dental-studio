import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { makeDemoArch } from '../src/geometry/demo';
import { buildStageSeries } from '../src/geometry/stageSeries';

/** Non-indexed copy of the demo with every vertex shifted by f(stage) where x > 10 (a "moving tooth"). */
function stage(base: BufferGeometry, k: number) {
  const g = base.toNonIndexed();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (p.getX(i) > 10) p.setY(i, p.getY(i) + 0.1 * k);
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(p.array as ArrayLike<number>), 3));
  return out;
}

describe('stage series', () => {
  const base = makeDemoArch('lower').geometry;
  it('detects a shared layout and keeps only positions per stage', () => {
    const s = buildStageSeries([0, 1, 2, 3].map((k) => stage(base, k)));
    expect(s.shared).toBe(true);
    if (!s.shared) return;
    expect(s.positions.length).toBe(4);
    expect(s.index.length).toBe(base.index!.count);
    // vertices really merged (same count as the indexed demo, not one per triangle corner)
    expect(s.positions[0].length / 3).toBe(base.getAttribute('position').count);
    // a moved vertex differs by 0.3 mm between stage 0 and 3
    const i = Array.from({ length: s.positions[0].length / 3 }, (_, k) => k).find((k) => s.positions[0][3 * k] > 10)!;
    expect(s.positions[3][3 * i + 1] - s.positions[0][3 * i + 1]).toBeCloseTo(0.3, 4);
  });
  it('falls back to separate meshes when the layouts differ', () => {
    const other = makeDemoArch('lower', 0.25).geometry;
    const s = buildStageSeries([stage(base, 0), other.toNonIndexed()]);
    expect(s.shared).toBe(false);
  });
});
