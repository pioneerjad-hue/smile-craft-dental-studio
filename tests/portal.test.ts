import { describe, expect, it } from 'vitest';
import { defaultPreferences, emptyRx, RECORD_SLOTS } from '../src/portal/model';
import type { PortalCase } from '../src/portal/model';
import { demoPlan, seedDb } from '../src/portal/seed';
import {
  availableActions,
  needsAction,
  nextStatus,
  parsePlanJson,
  pipelineIndex,
  preferencesToProtocol,
  productForStages,
  recordsCheck,
  reviewPlan,
  treatmentWeeks,
} from '../src/portal/workflow';

const studioExport = {
  case: { patientName: 'Test', caseId: 'T-1', clinician: '', notes: '', createdAt: '' },
  protocol: { name: 'Smile Craft standard aligner protocol', version: 1 },
  stages: { total: 18, upper: 18, lower: 12, weeks: 18 },
  teeth: [
    { id: 11, mesial: 0, buccal: 0.5, extrusion: 0, tip: 0, torque: 0, rotation: 10, startStage: 0, locked: false, extracted: false, attachments: [] },
    { id: 13, mesial: 0, buccal: 0, extrusion: 0, tip: 0, torque: 0, rotation: 40, startStage: 2, locked: false, extracted: false, attachments: [{ type: 'rectangularVertical', stageFrom: 1 }] },
    { id: 31, mesial: 0, buccal: 0, extrusion: 0, tip: 0, torque: 0, rotation: 0, startStage: 0, locked: true, extracted: false, attachments: [] },
    { id: 99, mesial: 1 },
  ],
  ipr: [
    { contact: '41-31', amountMm: 0.2, stage: 2 },
    { contact: '12-11', amountMm: 0.3, stage: 1 },
    { contact: 'bad', amountMm: 0.3, stage: 1 },
  ],
  notes: 'note',
};

describe('portal workflow', () => {
  it('only allows the right role to move a case forward', () => {
    expect(nextStatus('draft', 'submit', 'doctor')).toBe('submitted');
    expect(nextStatus('plan_ready', 'approve', 'doctor')).toBe('approved');
    expect(nextStatus('refinement', 'start_planning', 'lab')).toBe('planning');
    expect(() => nextStatus('plan_ready', 'approve', 'lab')).toThrow();
    expect(() => nextStatus('draft', 'approve', 'doctor')).toThrow();
    expect(availableActions('plan_ready', 'doctor').map((a) => a.action)).toEqual(['approve', 'request_modification', 'cancel']);
    expect(availableActions('approved', 'doctor')).toEqual([]);
  });

  it('maps every status onto the pipeline (except cancelled)', () => {
    const statuses = ['draft', 'submitted', 'records_issue', 'planning', 'plan_ready', 'modification_requested', 'approved', 'manufacturing', 'shipped', 'in_treatment', 'refinement', 'retention', 'completed'] as const;
    for (const s of statuses) expect(pipelineIndex(s)).toBeGreaterThanOrEqual(0);
    expect(pipelineIndex('cancelled')).toBe(-1);
  });

  it('checks the record set against the treated arches', () => {
    const rx = emptyRx(defaultPreferences());
    const all = RECORD_SLOTS.map((s, i) => ({ id: String(i), slot: s.slot, kind: s.kind, name: '', size: 1, mime: '', uploadedAt: '', uploadedBy: 'doctor' as const, hasBlob: false }));
    expect(recordsCheck({ rx, records: all }).complete).toBe(true);
    const noLower = all.filter((r) => r.slot !== 'scan_lower');
    expect(recordsCheck({ rx, records: noLower }).missing).toEqual(['Lower scan']);
    expect(recordsCheck({ rx: { ...rx, arches: 'upper' }, records: noLower }).complete).toBe(true);
    expect(recordsCheck({ rx, records: [] }).photos).toBe(0);
  });

  it('flags cases waiting on each side', () => {
    const db = seedDb();
    const byStatus = (s: string) => db.cases.find((c) => c.status === s)!;
    expect(needsAction(byStatus('plan_ready'), 'doctor')).toBe(true);
    expect(needsAction(byStatus('planning'), 'doctor')).toBe(false);
    expect(needsAction(byStatus('planning'), 'lab')).toBe(true);
    expect(needsAction(byStatus('completed'), 'lab')).toBe(false);
  });
});

describe('plan import from the studio', () => {
  it('parses the studio "Plan summary (JSON)" export and drops invalid entries', () => {
    const p = parsePlanJson(JSON.stringify(studioExport));
    expect(p.teeth.map((t) => t.id)).toEqual([13, 11, 31]);
    expect(p.ipr.map((e) => e.contact)).toEqual(['41-31', '12-11']);
    expect(p.stages).toEqual({ total: 18, upper: 18, lower: 12, weeks: 18 });
    expect(p.teeth[0].attachments).toEqual([{ type: 'rectangularVertical', stageFrom: 1 }]);
    expect(p.teeth[2].locked).toBe(true);
    expect(p.protocolName).toBe('Smile Craft standard aligner protocol');
  });

  it('rejects files that are not plans', () => {
    expect(() => parsePlanJson('nope')).toThrow(/valid JSON/);
    expect(() => parsePlanJson('{"a":1}')).toThrow(/teeth/);
    expect(() => parsePlanJson('{"teeth":[{"id":99}]}')).toThrow(/FDI/);
  });

  it('reviews a plan against limits, the Rx and the product', () => {
    const plan = parsePlanJson(JSON.stringify(studioExport));
    const rx = { ...emptyRx(defaultPreferences()), product: 'lite' as const, doNotMove: [11], attachmentsAllowed: false, ipr: 'no' as const };
    const r = reviewPlan(plan, { rx });
    expect(r.moving.map((t) => t.id)).toEqual([13, 11]);
    expect(r.flags.some((f) => f.tooth === 13 && /Rotation 40/.test(f.text))).toBe(true);
    expect(r.iprTotal.upper).toBeCloseTo(0.3);
    expect(r.iprTotal.lower).toBeCloseTo(0.2);
    expect(r.attachmentCount).toBe(1);
    expect(r.fitsProduct).toBe(false);
    expect(r.suggestedProduct).toBe('moderate');
    expect(r.rxConflicts).toHaveLength(3);
  });

  it('picks the smallest product and estimates duration', () => {
    expect(productForStages(5)).toBe('express');
    expect(productForStages(14)).toBe('lite');
    expect(productForStages(26)).toBe('moderate');
    expect(productForStages(40)).toBe('comprehensive');
    expect(treatmentWeeks(demoPlan('crowding'), 10)).toBe(Math.ceil((22 * 10) / 7));
  });
});

describe('clinical preferences', () => {
  it('produce a studio protocol that follows them', () => {
    const prefs = { ...defaultPreferences(), iprAllowed: false, attachmentsAllowed: false, daysPerAligner: 10, attachmentStage: 2, notes: 'Keep 16/26 as anchors' };
    const p = preferencesToProtocol(prefs, 'Dr. Test');
    expect(p.ipr.maxTotalPerArchMm).toBe(0);
    expect(p.attachments.rules).toEqual([]);
    expect(p.attachments.defaultStage).toBe(1);
    expect(p.staging.daysPerStage).toBe(10);
    expect(p.clinicalNotes).toContain('Keep 16/26 as anchors');
    expect(p.name).toContain('Dr. Test');
  });
});

describe('demo data', () => {
  it('is internally consistent', () => {
    const db = seedDb();
    const ids = new Set(db.cases.map((c) => c.id));
    expect(ids.size).toBe(db.cases.length);
    const pr = db.cases.find((c) => c.status === 'plan_ready') as PortalCase;
    expect(pr.plans.at(-1)!.status).toBe('pending');
    for (const c of db.cases.filter((x) => x.status !== 'draft' && x.status !== 'records_issue')) expect(recordsCheck(c).complete).toBe(true);
  });
});
