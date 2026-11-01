import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { ArchModel, seedRadiusMm } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';
import { autoSegmentSeeds } from '../src/geometry/autoSegment';
import { computeArchFrames } from '../src/geometry/frames';
import { registerSetup } from '../src/geometry/registerSetup';
import { defaultProtocol } from '../src/core/protocol';
import { movementFromMatrix, movementMatrix } from '../src/core/transform';
import { zeroMovement } from '../src/core/types';
import type { Movement } from '../src/core/types';

describe('reference setup import', () => {
  it('recovers each tooth movement from a final-setup model', () => {
    const demo = makeDemoArch('lower');
    const model = new ArchModel('lower', demo.geometry);
    const { teeth, gum } = autoSegmentSeeds(model, 'lower', demo.teeth.map((t) => t.id));
    for (const s of teeth) model.addSeed(s.v, s.tooth);
    model.paintVertices(gum, 0);
    model.segment((id) => seedRadiusMm(id));
    const frames = computeArchFrames(model, defaultProtocol());
    const planned: Record<number, Movement> = {
      41: { ...zeroMovement(), buccal: -1.1, rotation: 6 },
      42: { ...zeroMovement(), rotation: -14, tip: 4 },
      33: { ...zeroMovement(), rotation: 10, extrusion: 0.6 },
      36: { ...zeroMovement(), mesial: -1.5 },
      45: { ...zeroMovement(), torque: 8, buccal: 0.5 },
    };
    const T = new Map(Object.entries(planned).map(([id, m]) => [+id, movementMatrix(frames[+id], m)]));
    // "exported" final model: same scan deformed (gum follows), as another program would produce
    const final = new BufferGeometry();
    final.setAttribute('position', new BufferAttribute(model.deformedPositions(T), 3));
    final.setIndex(new BufferAttribute(model.index, 1));
    const fits = registerSetup(model, frames, final);
    for (const id of model.teeth()) {
      const got = movementFromMatrix(frames[id], fits[id].T);
      const want = planned[id] ?? zeroMovement();
      expect(Math.abs(got.mesial - want.mesial)).toBeLessThan(0.15);
      expect(Math.abs(got.buccal - want.buccal)).toBeLessThan(0.15);
      expect(Math.abs(got.extrusion - want.extrusion)).toBeLessThan(0.15);
      expect(Math.abs(got.rotation - want.rotation)).toBeLessThan(1.5);
      expect(Math.abs(got.tip - want.tip)).toBeLessThan(1.5);
      expect(Math.abs(got.torque - want.torque)).toBeLessThan(1.5);
      expect(fits[id].rmsMm).toBeLessThan(0.1);
    }
  }, 120000);
});
