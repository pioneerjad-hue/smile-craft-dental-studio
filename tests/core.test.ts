import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { movementMatrix, v3 } from '../src/core/transform';
import { computeStaging, maxStep, movementAtStage, stageFraction } from '../src/core/staging';
import { defaultProtocol } from '../src/core/protocol';
import { bolton } from '../src/core/analysis';
import { suggestIpr, validatePlan } from '../src/core/validate';
import { adjacentPairs, contactKey, contralateral, mesialStep, shortLabel } from '../src/core/fdi';
import { applyAiPlan } from '../src/core/aiBrief';
import type { Movement, ToothFrame, ToothPlan, TreatmentPlan } from '../src/core/types';
import { zeroMovement } from '../src/core/types';

/** Upper-left central incisor in a z-up scan: occlusal is -z, mesial is +x (toward midline), buccal +y. */
const frame: ToothFrame = {
  id: 21,
  centroid: [-4, 25, 20],
  mesial: [1, 0, 0],
  buccal: [0, 1, 0],
  occlusal: [0, 0, -1],
  pivot: [-4, 25, 30],
  autoWidthMm: 8.6,
  crownHeightMm: 10,
};
const incisalTip = new Vector3(-4, 25, 15); // 5 mm occlusal of the centroid
const mesialSurface = new Vector3(0.3, 25, 20);

const apply = (m: Partial<Movement>, p: Vector3) => p.clone().applyMatrix4(movementMatrix(frame, { ...zeroMovement(), ...m }));

describe('movement sign conventions', () => {
  it('translations follow the clinical frame', () => {
    const c = v3(frame.centroid);
    expect(apply({ mesial: 1 }, c).x).toBeCloseTo(-3);
    expect(apply({ buccal: 1 }, c).y).toBeCloseTo(26);
    expect(apply({ extrusion: 1 }, c).z).toBeCloseTo(19); // toward occlusal (-z)
  });
  it('positive tip moves the incisal edge mesially', () => {
    expect(apply({ tip: 5 }, incisalTip).x).toBeGreaterThan(incisalTip.x + 0.5);
  });
  it('positive torque moves the incisal edge buccally', () => {
    expect(apply({ torque: 5 }, incisalTip).y).toBeGreaterThan(incisalTip.y + 0.5);
  });
  it('positive rotation moves the mesial surface lingually', () => {
    expect(apply({ rotation: 10 }, mesialSurface).y).toBeLessThan(mesialSurface.y - 0.3);
  });
  it('rotations preserve distances (rigid)', () => {
    const m = movementMatrix(frame, { mesial: 1, buccal: -2, extrusion: 0.5, tip: 7, torque: -4, rotation: 20 });
    const a = incisalTip.clone().applyMatrix4(m);
    const b = mesialSurface.clone().applyMatrix4(m);
    expect(a.distanceTo(b)).toBeCloseTo(incisalTip.distanceTo(mesialSurface), 6);
  });
});

function toothPlan(id: number, movement: Partial<Movement>, startStage = 0): ToothPlan {
  return { id, movement: { ...zeroMovement(), ...movement }, startStage, attachments: [] };
}
const samples: [number, number, number][] = [
  [-4, 25, 15],
  [0.3, 25, 20],
  [-8.3, 25, 20],
  [-4, 27, 20],
];

describe('staging', () => {
  const protocol = defaultProtocol();
  it('uses the most demanding degree of freedom', () => {
    const s = computeStaging(protocol, [{ plan: toothPlan(21, { mesial: 1, rotation: 10 }), frame, samples: [] }]);
    // 1 mm / 0.25 = 4 stages; 10° / 2° = 5 stages
    expect(s.totalStages).toBe(5);
    expect(s.teeth[21].limitingFactor).toBe('rotation');
  });
  it('respects the crown displacement limit for large torque', () => {
    const plan = toothPlan(21, { torque: 12 });
    const s = computeStaging(protocol, [{ plan, frame, samples }]);
    expect(maxStep(frame, plan.movement, s.totalStages, samples)).toBeLessThanOrEqual(protocol.staging.limits.crownDisplacementMm + 1e-9);
    expect(s.totalStages).toBeGreaterThanOrEqual(8);
  });
  it('synchronizes arches and supports delayed starts', () => {
    const lower: ToothFrame = { ...frame, id: 31 };
    const s = computeStaging(protocol, [
      { plan: toothPlan(21, { mesial: 2 }), frame, samples: [] },
      { plan: toothPlan(31, { mesial: 0.5 }, 3), frame: lower, samples: [] },
    ]);
    expect(s.archStages.upper).toBe(8);
    expect(s.archStages.lower).toBe(8);
    expect(s.teeth[31].start).toBe(3);
    expect(stageFraction(s.teeth[31], 3)).toBe(0);
    expect(stageFraction(s.teeth[31], 8)).toBe(1);
    expect(movementAtStage(toothPlan(21, { mesial: 2 }), s.teeth[21], 4).mesial).toBeCloseTo(1);
  });
  it('maxRate mode finishes each tooth as early as possible', () => {
    const p = { ...protocol, staging: { ...protocol.staging, mode: 'maxRate' as const } };
    const s = computeStaging(p, [
      { plan: toothPlan(21, { mesial: 2 }), frame, samples: [] },
      { plan: toothPlan(22, { mesial: 0.5 }), frame: { ...frame, id: 22 }, samples: [] },
    ]);
    expect(s.teeth[22].end).toBe(2);
    expect(s.teeth[21].end).toBe(8);
  });
  it('locked teeth never move', () => {
    const plan = { ...toothPlan(21, { mesial: 2 }), locked: true };
    const s = computeStaging(protocol, [{ plan, frame, samples: [] }]);
    expect(s.totalStages).toBe(0);
    expect(movementAtStage(plan, s.teeth[21], 5).mesial).toBe(0);
  });
});

describe('analysis and validation', () => {
  const widths: Record<number, number> = { 13: 7.5, 12: 6.5, 11: 8.5, 21: 8.5, 22: 6.5, 23: 7.5, 43: 6.5, 42: 5.5, 41: 5, 31: 5, 32: 5.5, 33: 6.5 };
  const plan: TreatmentPlan = { teeth: {}, ipr: [], notes: '' };
  for (const [id, w] of Object.entries(widths)) plan.teeth[+id] = { ...toothPlan(+id, {}), manualWidthMm: w };

  it('computes the anterior Bolton ratio', () => {
    const b = bolton(plan, {}, 'anterior');
    expect(b.upperSum).toBeCloseTo(45);
    expect(b.lowerSum).toBeCloseTo(34);
    expect(b.ratio).toBeCloseTo(75.56, 1);
    expect(b.excessMm).toBeLessThan(0); // maxillary excess
    expect(b.missing).toEqual([]);
  });

  it('flags protocol violations and missing attachments', () => {
    const protocol = defaultProtocol();
    const p: TreatmentPlan = { teeth: { 13: toothPlan(13, { rotation: 30 }) }, ipr: [{ contact: '12-11', amountMm: 0.6, stage: 1 }], notes: '' };
    const issues = validatePlan(protocol, p, null, null);
    const rules = issues.map((i) => i.rule);
    expect(rules).toContain('TOTAL-ROTATION'); // canine limit 25°
    expect(rules).toContain('ATT-ROT');
    expect(rules).toContain('IPR-CONTACT'); // anterior limit 0.4
    expect(issues[0].severity).toBe('error');
  });

  it('suggests IPR from measured overlaps', () => {
    const protocol = defaultProtocol();
    const s = suggestIpr(protocol, [
      { contact: '12-11', a: 12, b: 11, stage: 10, distanceMm: -0.23 },
      { contact: '11-21', a: 11, b: 21, stage: 10, distanceMm: -0.05 },
      { contact: '22-23', a: 22, b: 23, stage: 10, distanceMm: -0.9 },
    ]);
    expect(s.find((x) => x.contact === '12-11')?.amountMm).toBeCloseTo(0.3);
    expect(s.find((x) => x.contact === '11-21')).toBeUndefined();
    const capped = s.find((x) => x.contact === '22-23')!;
    expect(capped.amountMm).toBeCloseTo(0.4);
    expect(capped.capped).toBe(true);
  });
});

describe('FDI helpers', () => {
  it('orders contacts and directions', () => {
    expect(mesialStep(11)).toBe(1);
    expect(mesialStep(21)).toBe(-1);
    expect(contactKey(21, 11)).toBe('11-21');
    expect(contralateral(36)).toBe(46);
    expect(shortLabel(36)).toBe('LL6');
    expect(adjacentPairs('upper', [11, 21, 13])).toEqual([[13, 11], [11, 21]]);
  });
});

describe('AI plan import', () => {
  it('applies valid entries and reports problems', () => {
    const plan: TreatmentPlan = { teeth: { 11: toothPlan(11, {}), 21: toothPlan(21, {}) }, ipr: [], notes: '' };
    const res = applyAiPlan(
      plan,
      {
        format: 'smile-craft/ai-plan@1',
        teeth: { '11': { rotation: 8, attachments: ['ellipsoid'] }, '31': { mesial: 1 }, '21': { tip: 'x' } },
        ipr: [{ contact: '11-21', amountMm: 0.2, stage: 2 }],
      },
      [11, 21],
      defaultProtocol(),
    );
    expect(res.plan.teeth[11].movement.rotation).toBe(8);
    expect(res.plan.teeth[11].attachments[0].type).toBe('ellipsoid');
    expect(res.plan.ipr).toEqual([{ contact: '11-21', amountMm: 0.2, stage: 2 }]);
    expect(res.problems.length).toBe(2);
    expect(plan.teeth[11].movement.rotation).toBe(0); // original untouched
  });
});

import { constrainMovement } from '../src/core/constraints';

describe('constraints', () => {
  it('locks axes, locks teeth, and optionally clamps to protocol limits', () => {
    const protocol = defaultProtocol();
    const tp: ToothPlan = { ...toothPlan(13, {}), lockedAxes: ['torque'] };
    const r = constrainMovement(protocol, tp, { ...zeroMovement(), torque: 5, rotation: 40 });
    expect(r.movement.torque).toBe(0);
    expect(r.movement.rotation).toBe(40); // soft limits by default
    expect(r.notes.length).toBe(1);
    const hard = { ...protocol, constraints: { enforceTotalLimits: true } };
    expect(constrainMovement(hard, tp, { ...zeroMovement(), rotation: 40 }).movement.rotation).toBe(25);
    const t = constrainMovement(hard, tp, { ...zeroMovement(), mesial: 6, buccal: 8 }).movement;
    expect(Math.hypot(t.mesial, t.buccal)).toBeCloseTo(4);
    expect(constrainMovement(protocol, { ...tp, locked: true }, { ...zeroMovement(), mesial: 1 }).movement.mesial).toBe(0);
  });
  it('AI plan import respects constraints', () => {
    const plan: TreatmentPlan = { teeth: { 11: { ...toothPlan(11, {}), lockedAxes: ['rotation'] } }, ipr: [], notes: '' };
    const res = applyAiPlan(plan, { format: 'smile-craft/ai-plan@1', teeth: { '11': { rotation: 8, mesial: 0.5 } } }, [11], defaultProtocol());
    expect(res.plan.teeth[11].movement.rotation).toBe(0);
    expect(res.plan.teeth[11].movement.mesial).toBe(0.5);
    expect(res.problems.length).toBe(1);
  });
});
