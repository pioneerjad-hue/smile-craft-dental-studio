import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Vector3 } from 'three';
import { ArchModel } from '../src/geometry/archModel';
import { makeDemoArch } from '../src/geometry/demo';
import { estimatePatientFrame, frameFromLandmarks, frameToMatrix } from '../src/geometry/orient';

const deg = (a: Vector3, b: Vector3) => (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;

describe('model orientation', () => {
  for (const [label, euler] of [
    ['tilted scan', new Euler(0.4, -0.3, 1.1)],
    ['upside-down, turned scan', new Euler(Math.PI, 0.2, -2.3)],
  ] as const) {
    it(`recovers the patient frame from a ${label}`, () => {
      const scramble = new Matrix4().makeRotationFromEuler(euler).setPosition(40, -12, 7);
      const arches = (['upper', 'lower'] as const).map((arch) => {
        const model = new ArchModel(arch, makeDemoArch(arch).geometry);
        model.applyMatrix(scramble);
        return { arch, model };
      });
      const f = estimatePatientFrame(arches);
      const R = new Matrix4().extractRotation(scramble);
      // demo truth: right +x, anterior +y, up +z in the original coordinates
      expect(deg(f.up, new Vector3(0, 0, 1).applyMatrix4(R))).toBeLessThan(4);
      expect(deg(f.anterior, new Vector3(0, 1, 0).applyMatrix4(R))).toBeLessThan(4);
      expect(deg(f.right, new Vector3(1, 0, 0).applyMatrix4(R))).toBeLessThan(5);
      // applying the frame matrix brings the scan back to canonical axes
      const m = frameToMatrix(f);
      const up = new Vector3(0, 0, 1).applyMatrix4(R).transformDirection(m);
      expect(up.z).toBeGreaterThan(0.99);
    });
  }

  it('builds the frame from three landmarks', () => {
    const f = frameFromLandmarks(new Vector3(0, 25, 13), new Vector3(23, -1, 11), new Vector3(-23, -1, 11), new Vector3(0, 0, 1));
    expect(f.up.z).toBeGreaterThan(0.99);
    expect(f.anterior.y).toBeGreaterThan(0.99);
    expect(f.right.x).toBeGreaterThan(0.99);
  });
});
