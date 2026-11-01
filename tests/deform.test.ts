import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { ArchModel, seedRadiusMm } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';

describe('staged deformation', () => {
  const demo = makeDemoArch('lower');
  const model = new ArchModel('lower', demo.geometry);
  const v = new Vector3();
  for (const t of demo.teeth) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < model.vertexCount; i++) {
      const d = model.position(i, v).distanceToSquared(new Vector3(t.x, t.y, t.top));
      if (d < bd) (bd = d), (best = i);
    }
    model.addSeed(best, t.id);
  }
  model.segment((id) => seedRadiusMm(id));

  it('moves teeth rigidly, blends gum, keeps topology, and is fast', () => {
    const T = new Map<number, Matrix4>();
    for (const t of demo.teeth) T.set(t.id, new Matrix4().makeTranslation(0.5, 0, 0));
    const t0 = performance.now();
    const pos = model.deformedPositions(T);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1500);
    const toothV = model.toothVertices(41)[0];
    expect(pos[3 * toothV] - model.base[3 * toothV]).toBeCloseTo(0.5, 5);
    // a gum vertex far from all teeth stays put; gum next to a tooth follows partially
    let far = -1, near = -1;
    for (let i = 0; i < model.vertexCount && (far < 0 || near < 0); i++) {
      if (model.labels[i]) continue;
      const moved = pos[3 * i] - model.base[3 * i];
      if (model.boundary[i] && far < 0) far = i;
      if (moved > 0.1 && moved < 0.49 && near < 0) near = i;
    }
    expect(pos[3 * far] - model.base[3 * far]).toBeCloseTo(0, 6);
    expect(near).toBeGreaterThanOrEqual(0);
    // second call uses cached weights
    const t1 = performance.now();
    model.deformedPositions(T);
    expect(performance.now() - t1).toBeLessThan(200);
  });
});
