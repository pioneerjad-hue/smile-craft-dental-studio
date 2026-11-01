import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { ArchModel, seedRadiusMm } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';
import { computeArchFrames } from '../src/geometry/frames';
import { defaultProtocol } from '../src/core/protocol';

describe('performance at intraoral-scan density', () => {
  it('segments, computes frames and deforms a ~450k-triangle arch interactively', () => {
    const demo = makeDemoArch('lower', 0.1);
    let t = performance.now();
    const model = new ArchModel('lower', demo.geometry);
    const tBuild = performance.now() - t;
    const v = new Vector3();
    for (const tooth of demo.teeth) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < model.vertexCount; i++) {
        const d = model.position(i, v).distanceToSquared(new Vector3(tooth.x, tooth.y, tooth.top));
        if (d < bd) (bd = d), (best = i);
      }
      model.addSeed(best, tooth.id);
    }
    t = performance.now();
    model.segment((id) => seedRadiusMm(id));
    const tSeg = performance.now() - t;
    t = performance.now();
    computeArchFrames(model, defaultProtocol());
    const tFrames = performance.now() - t;
    const T = new Map(demo.teeth.map((x) => [x.id, new Matrix4().makeTranslation(0.3, 0, 0)]));
    t = performance.now();
    model.deformedPositions(T);
    const tFirst = performance.now() - t;
    t = performance.now();
    model.deformedPositions(T);
    const tDeform = performance.now() - t;
    console.log(`faces ${model.faceCount} build ${tBuild.toFixed(0)}ms segment ${tSeg.toFixed(0)}ms frames ${tFrames.toFixed(0)}ms deform first ${tFirst.toFixed(0)}ms / cached ${tDeform.toFixed(0)}ms`);
    expect(model.faceCount).toBeGreaterThan(400000);
    expect(tSeg).toBeLessThan(2500);
    expect(tDeform).toBeLessThan(300);
  }, 60000);
});
