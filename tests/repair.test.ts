import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { makeDemoArch } from '../src/geometry/demo';
import { fillSmallHoles, fromGeometry, removeSmallComponents, toGeometry, trimByPlane } from '../src/geometry/repair';
import { boundaryLoops, buildModelBase, openEdgeCount } from '../src/geometry/modelBase';
import { ArchModel } from '../src/geometry/archModel';

describe('model preparation', () => {
  const demo = fromGeometry(makeDemoArch('lower').geometry);

  it('removes floating debris', () => {
    const n = demo.position.length / 3;
    const position = new Float32Array([...demo.position, 0, 0, 40, 1, 0, 40, 0, 1, 40]);
    const index = new Uint32Array([...demo.index, n, n + 1, n + 2]);
    const { mesh, removed } = removeSmallComponents({ position, index });
    expect(removed).toBe(1);
    expect(mesh.index.length).toBe(demo.index.length);
  });

  it('fills small scan holes but keeps the border open', () => {
    // punch a hole in the gum: drop faces whose centroid is within 1.2 mm of a gum point
    const P = demo.position;
    const c = new Vector3(0, 30.5, 0);
    let best = Infinity;
    for (let i = 0; i < P.length / 3; i++) {
      const d = Math.hypot(P[3 * i] - 0, P[3 * i + 1] - 30.5);
      if (d < best) (best = d), (c.z = P[3 * i + 2]);
    }
    const kept: number[] = [];
    for (let f = 0; f < demo.index.length; f += 3) {
      const ids = [demo.index[f], demo.index[f + 1], demo.index[f + 2]];
      const cx = ids.reduce((s, v) => s + P[3 * v], 0) / 3, cy = ids.reduce((s, v) => s + P[3 * v + 1], 0) / 3;
      if (Math.hypot(cx - c.x, cy - c.y) > 1.2) kept.push(...ids);
    }
    const holed = { position: demo.position, index: new Uint32Array(kept) };
    expect(boundaryLoops(holed.index, P.length / 3).length).toBe(2);
    const { mesh, filled } = fillSmallHoles(holed);
    expect(filled).toBe(1);
    expect(boundaryLoops(mesh.index, P.length / 3).length).toBe(1);
  });

  it('trims exactly along a plane and still closes into a watertight model', () => {
    const trimmed = trimByPlane(demo, new Vector3(0, 0, 4), new Vector3(0, 0, 1));
    for (let i = 0; i < trimmed.position.length / 3; i++) expect(trimmed.position[3 * i + 2]).toBeGreaterThan(4 - 1e-4);
    const model = new ArchModel('lower', toGeometry(trimmed));
    const base = buildModelBase(model, new Vector3(0, 0, 1), { thicknessMm: 3 })!;
    const index = new Uint32Array(model.index.length + base.index.length);
    index.set(model.index);
    index.set(base.index, model.index.length);
    expect(openEdgeCount(index, model.vertexCount + base.positions.length / 3)).toBe(0);
  });
});
