/** Demo data so the portal can be explored without patient records. All patients are fictional. */
import { LOWER_SEQUENCE, UPPER_SEQUENCE, contactKey } from '../core/fdi';
import { PRODUCTS, RECORD_SLOTS, defaultPreferences, emptyRx } from './model';
import type { CaseStatus, PlanSummary, PlanTooth, PortalCase, PortalDb, Prescription, RecordFile } from './model';

const DAY = 86400000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3600000).toISOString();

function tooth(id: number, m: Partial<PlanTooth> = {}): PlanTooth {
  return { id, mesial: 0, buccal: 0, extrusion: 0, tip: 0, torque: 0, rotation: 0, startStage: 0, locked: false, extracted: false, attachments: [], ...m };
}

/** A plausible crowding-resolution plan (expansion + proclination + light IPR). */
export function demoPlan(variant: 'crowding' | 'spacing' | 'mild' = 'crowding'): PlanSummary {
  const ids = [...UPPER_SEQUENCE, ...LOWER_SEQUENCE].filter((id) => id % 10 !== 8);
  const mv: Record<number, Partial<PlanTooth>> =
    variant === 'crowding'
      ? {
          11: { buccal: 0.8, rotation: -8, torque: 4, extrusion: 0.3 },
          21: { buccal: 0.6, rotation: 12, torque: 3 },
          12: { buccal: 1.4, rotation: 18, extrusion: 0.8, attachments: [{ type: 'ellipsoid', stageFrom: 1 }] },
          22: { buccal: 1.1, mesial: -0.4, rotation: -10 },
          13: { buccal: 0.9, rotation: 22, extrusion: 0.4, attachments: [{ type: 'rectangularVertical', stageFrom: 1 }] },
          23: { buccal: 0.7, rotation: -16, attachments: [{ type: 'rectangularVertical', stageFrom: 1 }] },
          14: { buccal: 0.9, rotation: 6, attachments: [{ type: 'beveledGingival', stageFrom: 1 }] },
          24: { buccal: 0.8, attachments: [{ type: 'beveledGingival', stageFrom: 1 }] },
          15: { buccal: 0.6 },
          25: { buccal: 0.5 },
          41: { buccal: 0.9, rotation: 10, extrusion: -0.6 },
          31: { buccal: 0.7, rotation: -14, extrusion: -0.5 },
          42: { buccal: 1.2, mesial: 0.3, rotation: -20, attachments: [{ type: 'ellipsoid', stageFrom: 1 }] },
          32: { buccal: 0.5, rotation: 9 },
          43: { buccal: 0.6, rotation: 28, tip: 4, attachments: [{ type: 'rectangularVertical', stageFrom: 1 }] },
          33: { buccal: 0.4, rotation: -12, attachments: [{ type: 'rectangularVertical', stageFrom: 1 }] },
          44: { buccal: 0.5, attachments: [{ type: 'rectangularHorizontal', stageFrom: 1 }] },
          34: { buccal: 0.5, attachments: [{ type: 'rectangularHorizontal', stageFrom: 1 }] },
        }
      : variant === 'spacing'
        ? {
            11: { mesial: 0.8, buccal: -0.9, torque: -5 },
            21: { mesial: 0.9, buccal: -0.8, torque: -5 },
            12: { mesial: 1.3, buccal: -0.6, attachments: [{ type: 'ellipsoid', stageFrom: 1 }] },
            22: { mesial: 1.2, buccal: -0.5, attachments: [{ type: 'ellipsoid', stageFrom: 1 }] },
            13: { mesial: 1.1, tip: -3, attachments: [{ type: 'rectangularVertical', stageFrom: 1 }] },
            23: { mesial: 1.0, tip: -3, attachments: [{ type: 'rectangularVertical', stageFrom: 1 }] },
          }
        : {
            11: { rotation: 6, buccal: 0.3 },
            21: { rotation: -5 },
            12: { buccal: 0.6, rotation: 8 },
            41: { buccal: 0.4, rotation: 7 },
            31: { rotation: -6 },
          };
  const teeth = ids.map((id) => tooth(id, mv[id]));
  const ipr =
    variant === 'crowding'
      ? [
          { contact: contactKey(13, 12), amountMm: 0.2, stage: 3 },
          { contact: contactKey(22, 23), amountMm: 0.2, stage: 3 },
          { contact: contactKey(42, 41), amountMm: 0.3, stage: 2 },
          { contact: contactKey(41, 31), amountMm: 0.2, stage: 2 },
          { contact: contactKey(31, 32), amountMm: 0.3, stage: 2 },
        ]
      : variant === 'mild'
        ? [{ contact: contactKey(41, 31), amountMm: 0.2, stage: 1 }]
        : [];
  const stages = variant === 'crowding' ? { total: 22, upper: 20, lower: 22 } : variant === 'spacing' ? { total: 16, upper: 16, lower: 0 } : { total: 9, upper: 8, lower: 9 };
  return { protocolName: 'Smile Craft standard aligner protocol', stages: { ...stages, weeks: stages.total }, teeth, ipr, notes: '' };
}

function seedRecords(slots: string[], at: string): RecordFile[] {
  return RECORD_SLOTS.filter((s) => slots.includes(s.slot)).map((s, i) => ({
    id: `seed-${s.slot}-${i}-${Math.random().toString(36).slice(2, 8)}`,
    slot: s.slot,
    kind: s.kind,
    name: s.kind === 'scan' ? `${s.slot === 'scan_upper' ? 'Upper' : 'Lower'}Jaw.stl` : `${s.slot}.jpg`,
    size: s.kind === 'scan' ? 18_400_000 : 640_000,
    mime: s.kind === 'scan' ? 'model/stl' : 'image/jpeg',
    uploadedAt: at,
    uploadedBy: 'doctor',
    hasBlob: false,
  }));
}

const ALL = RECORD_SLOTS.map((s) => s.slot);

export function seedDb(): PortalDb {
  const prefs = defaultPreferences();
  let n = 0;
  const mk = (
    first: string,
    last: string,
    status: CaseStatus,
    createdDaysAgo: number,
    rx: Partial<Prescription>,
    extra: Partial<PortalCase> = {},
  ): PortalCase => {
    n++;
    const created = ago(createdDaysAgo);
    return {
      id: `case-${n}`,
      number: `SC-2026-${String(n).padStart(4, '0')}`,
      createdAt: created,
      updatedAt: ago(Math.max(0, createdDaysAgo - 3)),
      status,
      patient: { firstName: first, lastName: last, dob: `19${80 + n * 2}-0${(n % 9) + 1}-1${n % 9}`, sex: n % 2 ? 'F' : 'M', chartNumber: `P-${1040 + n}` },
      rx: { ...emptyRx(prefs), ...rx },
      records: status === 'draft' ? seedRecords(['face_profile', 'face_front', 'face_smile'], created) : seedRecords(ALL, created),
      plans: [],
      messages: [],
      shipments: [],
      invoices: [],
      events: [{ at: created, by: 'doctor', text: status === 'draft' ? 'Draft created' : 'Case submitted' }],
      refinements: 0,
      ...extra,
    };
  };

  const plan = (version: number, summary: PlanSummary, daysAgo: number, status: PortalCase['plans'][number]['status'], extra: Partial<PortalCase['plans'][number]> = {}) => ({
    id: `plan-${n}-${version}`,
    version,
    createdAt: ago(daysAgo),
    designer: 'Smile Craft planning team',
    summary,
    labNotes: '',
    status,
    phase: 0,
    ...extra,
  });

  const cases: PortalCase[] = [];

  cases.push(
    mk('Maya', 'Khoury', 'plan_ready', 9, { product: 'moderate', chiefComplaint: 'Crowded lower front teeth, wants a straighter smile before her wedding.', overjet: 'improve' }),
  );
  cases[0].plans = [
    plan(1, demoPlan('crowding'), 1, 'pending', {
      labNotes: 'Crowding resolved with 1.5 mm expansion per side, mild proclination and 1.2 mm total IPR (lower anterior). 43 rotation 28° is staged slowly with an optimized attachment; consider an overcorrection stage.',
    }),
  ];
  cases[0].messages = [
    { id: 'm1', at: ago(1, 2), from: 'lab', author: 'Smile Craft planning team', text: 'Hi Doctor, the first plan for Maya is ready. Note the 43 rotation – we suggest keeping IPR at stage 2 so the canine has room. Happy to adjust.', readBy: ['lab'] },
  ];
  cases[0].events.push({ at: ago(7), by: 'lab', text: 'Records accepted – planning started' }, { at: ago(1), by: 'lab', text: 'Treatment plan v1 published' });

  cases.push(mk('Karim', 'Saad', 'records_issue', 5, { product: 'comprehensive', chiefComplaint: 'Deep bite and spacing upper arch.', overbite: 'correct_deep' }));
  cases[1].records = cases[1].records.filter((r) => r.slot !== 'scan_lower');
  cases[1].messages = [
    { id: 'm2', at: ago(2), from: 'lab', author: 'Smile Craft planning team', text: 'The lower scan is missing (only the upper arch was received). Could you upload the lower STL and a bite registration scan?', readBy: ['lab'] },
  ];
  cases[1].events.push({ at: ago(2), by: 'lab', text: 'New records requested: lower scan missing' });

  cases.push(mk('Nour', 'Abboud', 'planning', 3, { product: 'lite', arches: 'upper', chiefComplaint: 'Diastema between upper centrals.' }));
  cases[2].events.push({ at: ago(2), by: 'lab', text: 'Records accepted – planning started' });

  cases.push(mk('Ziad', 'Haddad', 'shipped', 30, { product: 'moderate', chiefComplaint: 'Upper and lower crowding.' }));
  cases[3].plans = [
    plan(1, demoPlan('crowding'), 22, 'modification_requested', { decidedAt: ago(20), doctorComment: 'Please reduce IPR on the lower anteriors and add expansion instead.', toothComments: [{ tooth: 41, text: 'No IPR mesial' }] }),
    plan(2, demoPlan('mild'), 15, 'approved', { decidedAt: ago(14) }),
  ];
  cases[3].shipments = [{ id: 's1', createdAt: ago(3), carrier: 'DHL Express', tracking: '1Z84 2210 9931', contents: 'Aligners 1–9 (upper + lower), attachment template, case', delivered: false }];
  cases[3].invoices = [{ id: 'i1', number: 'INV-2026-0141', date: ago(14), description: `${PRODUCTS.moderate.name} – treatment plan approved`, amountUsd: PRODUCTS.moderate.priceUsd, paid: false }];
  cases[3].events.push({ at: ago(14), by: 'doctor', text: 'Treatment plan v2 approved' }, { at: ago(10), by: 'lab', text: 'Manufacturing started' }, { at: ago(3), by: 'lab', text: 'Shipped via DHL Express' });

  cases.push(mk('Lara', 'Mansour', 'in_treatment', 120, { product: 'comprehensive', chiefComplaint: 'Class II division 2, deep bite.', apRight: 'improve', apLeft: 'improve', overbite: 'correct_deep' }, { currentAligner: 9 }));
  cases[4].plans = [plan(1, demoPlan('crowding'), 100, 'approved', { decidedAt: ago(98) })];
  cases[4].shipments = [{ id: 's2', createdAt: ago(80), carrier: 'Aramex', tracking: 'ARX 5521 0087', contents: 'Aligners 1–22, attachment template', delivered: true }];
  cases[4].invoices = [{ id: 'i2', number: 'INV-2026-0098', date: ago(98), description: `${PRODUCTS.comprehensive.name} – treatment plan approved`, amountUsd: PRODUCTS.comprehensive.priceUsd, paid: true }];
  cases[4].events.push({ at: ago(98), by: 'doctor', text: 'Treatment plan v1 approved' }, { at: ago(80), by: 'doctor', text: 'Aligners delivered – treatment started' });

  cases.push(mk('Elie', 'Tannous', 'draft', 0, { product: 'lite', chiefComplaint: 'Relapse after braces.' }));
  cases[5].events = [{ at: ago(0, 3), by: 'doctor', text: 'Draft created' }];

  cases.push(mk('Rami', 'Fakhoury', 'modification_requested', 14, { product: 'express', arches: 'upper', chiefComplaint: 'Spacing upper anteriors.' }));
  cases[6].plans = [
    plan(1, demoPlan('spacing'), 6, 'modification_requested', { decidedAt: ago(4), doctorComment: 'Close the spaces with more retraction and less tip on canines. Keep 13/23 as anchors if possible.', toothComments: [{ tooth: 13, text: 'No tip please' }, { tooth: 23, text: 'No tip please' }] }),
  ];
  cases[6].events.push({ at: ago(6), by: 'lab', text: 'Treatment plan v1 published' }, { at: ago(4), by: 'doctor', text: 'Modification requested on plan v1' });

  cases.push(mk('Sara', 'Bitar', 'completed', 400, { product: 'lite' }));
  cases[7].plans = [plan(1, demoPlan('mild'), 390, 'approved', { decidedAt: ago(388) })];
  cases[7].invoices = [
    { id: 'i3', number: 'INV-2025-0412', date: ago(388), description: `${PRODUCTS.lite.name} – treatment plan approved`, amountUsd: PRODUCTS.lite.priceUsd, paid: true },
    { id: 'i4', number: 'INV-2026-0019', date: ago(160), description: `${PRODUCTS.retainers.name}`, amountUsd: PRODUCTS.retainers.priceUsd, paid: true },
  ];
  cases[7].events.push({ at: ago(160), by: 'doctor', text: 'Retainers ordered' }, { at: ago(150), by: 'lab', text: 'Case closed' });

  return {
    schema: 1,
    doctor: {
      name: 'Dr. Rita Haddad',
      email: 'demo@smilecraft.dental',
      practice: 'Haddad Dental Care',
      addresses: [{ id: 'a1', label: 'Main clinic', line: 'Hamra Street, Bldg 12, 3rd floor', city: 'Beirut', country: 'Lebanon', phone: '+961 1 000 000' }],
    },
    preferences: prefs,
    cases,
    counter: n,
  };
}
