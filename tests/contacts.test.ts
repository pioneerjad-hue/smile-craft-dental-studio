import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { ArchModel, seedRadiusMm } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';
import { ToothBody, contactDistance } from '../src/geometry/contacts';
import { computeArchFrames } from '../src/geometry/frames';
import { defaultProtocol } from '../src/core/protocol';
import { movementMatrix } from '../src/core/transform';
import { zeroMovement } from '../src/core/types';

describe('interproximal contact measurement', () => {
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
  const frames = computeArchFrames(model, defaultProtocol());
  const O = new Vector3(0, 0, 1);
  const body = (id: number) => new ToothBody(model, id);
  const I = new Matrix4();
  const dist = (a: number, b: number, ta = I, tb = I) => {
    const A = body(a), B = body(b);
    return contactDistance(A, ta, B, tb, A.facingSamples(B.centroid, O), B.facingSamples(A.centroid, O), O);
  };

  it('reads ~0 at untreated tight contacts', () => {
    for (const [a, b] of [[45, 44], [35, 36], [46, 45], [36, 37]]) expect(Math.abs(dist(a, b))).toBeLessThan(0.2);
    // 41 is displaced labially (not interpenetrating 31); moving it 1.1 mm lingually back into its
    // slot restores a tight contact, while moving it mesially collides.
    expect(dist(41, 31)).toBeGreaterThan(-0.2);
    const T = movementMatrix(frames[41], { ...zeroMovement(), buccal: -1.1 });
    expect(Math.abs(dist(41, 31, T, I))).toBeLessThan(0.3);
    const T2 = movementMatrix(frames[41], { ...zeroMovement(), buccal: -1.1, mesial: 0.6 });
    expect(dist(41, 31, T2, I)).toBeLessThan(-0.4);
  });

  it('measures a gap and an overlap created by moving a tooth', () => {
    const f = frames[35];
    // 35 distal 1 mm → gap of ~1 mm to 34, overlap of ~1 mm with 36
    const T = movementMatrix(f, { ...zeroMovement(), mesial: -1 });
    expect(dist(34, 35, I, T)).toBeGreaterThan(0.7);
    expect(dist(34, 35, I, T)).toBeLessThan(1.3);
    expect(dist(35, 36, T, I)).toBeLessThan(-0.7);
    expect(dist(35, 36, T, I)).toBeGreaterThan(-1.3);
  });

  it('auto widths are within 1 mm of the generated crowns', () => {
    const truth: Record<number, number> = { 1: 5.4, 2: 5.9, 3: 6.8, 4: 7.0, 5: 7.2, 6: 11.0, 7: 10.4 };
    for (const t of demo.teeth) expect(Math.abs(frames[t.id].autoWidthMm - truth[t.id % 10])).toBeLessThan(1.0);
  });
});
