/** Pure portal rules: status workflow, action queue, records completeness, plan parsing and review. */
import { archOf, isAnterior, isValidTooth, sortTeeth } from '../core/fdi';
import { defaultProtocol } from '../core/protocol';
import { MOVEMENT_KEYS, MOVEMENT_META } from '../core/types';
import type { AttachmentType, IprEntry, Protocol } from '../core/types';
import { totalLimitsFor } from '../core/validate';
import { PRODUCTS, RECORD_SLOTS } from './model';
import type { CaseStatus, ClinicalPreferences, PlanSummary, PlanTooth, PortalCase, ProductId, Role } from './model';

/* ------------------------------------------------------------------ status workflow */

export type ActionId =
  | 'submit'
  | 'start_planning'
  | 'flag_records'
  | 'resubmit_records'
  | 'publish_plan'
  | 'approve'
  | 'request_modification'
  | 'start_manufacturing'
  | 'ship'
  | 'start_treatment'
  | 'order_refinement'
  | 'finish_treatment'
  | 'complete'
  | 'cancel';

interface Transition {
  action: ActionId;
  by: Role;
  from: CaseStatus[];
  to: CaseStatus;
  label: string;
}

export const TRANSITIONS: Transition[] = [
  { action: 'submit', by: 'doctor', from: ['draft'], to: 'submitted', label: 'Submit case' },
  { action: 'resubmit_records', by: 'doctor', from: ['records_issue'], to: 'submitted', label: 'Records updated – resubmit' },
  { action: 'start_planning', by: 'lab', from: ['submitted'], to: 'planning', label: 'Accept records, start planning' },
  { action: 'start_planning', by: 'lab', from: ['refinement'], to: 'planning', label: 'Start refinement planning' },
  { action: 'flag_records', by: 'lab', from: ['submitted', 'planning'], to: 'records_issue', label: 'Request new records' },
  { action: 'publish_plan', by: 'lab', from: ['planning', 'modification_requested'], to: 'plan_ready', label: 'Publish plan to doctor' },
  { action: 'approve', by: 'doctor', from: ['plan_ready'], to: 'approved', label: 'Approve plan' },
  { action: 'request_modification', by: 'doctor', from: ['plan_ready'], to: 'modification_requested', label: 'Request modification' },
  { action: 'start_manufacturing', by: 'lab', from: ['approved'], to: 'manufacturing', label: 'Start manufacturing' },
  { action: 'ship', by: 'lab', from: ['manufacturing'], to: 'shipped', label: 'Ship aligners' },
  { action: 'start_treatment', by: 'doctor', from: ['shipped'], to: 'in_treatment', label: 'Aligners delivered – start treatment' },
  { action: 'order_refinement', by: 'doctor', from: ['in_treatment'], to: 'refinement', label: 'Order refinement' },
  { action: 'finish_treatment', by: 'doctor', from: ['in_treatment'], to: 'retention', label: 'Finish active treatment' },
  { action: 'complete', by: 'lab', from: ['retention'], to: 'completed', label: 'Close case' },
  { action: 'cancel', by: 'doctor', from: ['draft', 'submitted', 'records_issue', 'planning', 'plan_ready', 'modification_requested'], to: 'cancelled', label: 'Cancel case' },
];

export function availableActions(status: CaseStatus, role: Role): Transition[] {
  return TRANSITIONS.filter((t) => t.by === role && t.from.includes(status));
}

export function nextStatus(status: CaseStatus, action: ActionId, role: Role): CaseStatus {
  const t = TRANSITIONS.find((x) => x.action === action && x.by === role && x.from.includes(status));
  if (!t) throw new Error(`Action "${action}" is not allowed for ${role} when the case is "${status}".`);
  return t.to;
}

/** Simplified pipeline shown as a progress tracker on every case. */
export const PIPELINE: { label: string; statuses: CaseStatus[] }[] = [
  { label: 'Submitted', statuses: ['draft', 'submitted', 'records_issue'] },
  { label: 'Planning', statuses: ['planning', 'modification_requested', 'refinement'] },
  { label: 'Your review', statuses: ['plan_ready'] },
  { label: 'Manufacturing', statuses: ['approved', 'manufacturing'] },
  { label: 'Shipped', statuses: ['shipped'] },
  { label: 'In treatment', statuses: ['in_treatment'] },
  { label: 'Retention', statuses: ['retention', 'completed'] },
];

export function pipelineIndex(status: CaseStatus): number {
  return PIPELINE.findIndex((p) => p.statuses.includes(status));
}

/** Statuses where the ball is in the given role's court. */
const WAITING_ON: Record<Role, CaseStatus[]> = {
  doctor: ['draft', 'records_issue', 'plan_ready', 'shipped'],
  lab: ['submitted', 'planning', 'modification_requested', 'approved', 'manufacturing', 'refinement'],
};

export function needsAction(c: PortalCase, role: Role): boolean {
  return WAITING_ON[role].includes(c.status) || unreadCount(c, role) > 0;
}

export function actionReason(c: PortalCase, role: Role): string {
  const reasons: Partial<Record<CaseStatus, string>> =
    role === 'doctor'
      ? { draft: 'Finish and submit the prescription', records_issue: 'New records requested', plan_ready: 'Review and approve the treatment plan', shipped: 'Confirm delivery to start treatment' }
      : { submitted: 'Review submitted records', planning: 'Design the treatment plan', modification_requested: 'Doctor requested changes', approved: 'Send to manufacturing', manufacturing: 'Ship aligners', refinement: 'Plan the refinement' };
  const r = reasons[c.status];
  if (r) return r;
  const n = unreadCount(c, role);
  return n ? `${n} unread message${n > 1 ? 's' : ''}` : '';
}

export function unreadCount(c: PortalCase, role: Role): number {
  return c.messages.filter((m) => m.from !== role && !m.readBy.includes(role)).length;
}

export function isActive(c: PortalCase): boolean {
  return c.status !== 'completed' && c.status !== 'cancelled';
}

/* ------------------------------------------------------------------ records */

export interface RecordsCheck {
  complete: boolean;
  missing: string[];
  photos: number;
  photosTotal: number;
}

export function recordsCheck(c: Pick<PortalCase, 'records' | 'rx'>): RecordsCheck {
  const have = new Set(c.records.map((r) => r.slot));
  const needed = RECORD_SLOTS.filter((s) => {
    if (!s.required) return false;
    if (s.slot === 'scan_upper') return c.rx.arches !== 'lower';
    if (s.slot === 'scan_lower') return c.rx.arches !== 'upper';
    return true;
  });
  const missing = needed.filter((s) => !have.has(s.slot)).map((s) => s.label);
  const photoSlots = RECORD_SLOTS.filter((s) => s.kind === 'photo');
  return { complete: missing.length === 0, missing, photos: photoSlots.filter((s) => have.has(s.slot)).length, photosTotal: photoSlots.length };
}

/* ------------------------------------------------------------------ plan import */

const ATTACHMENT_TYPES: AttachmentType[] = ['rectangularVertical', 'rectangularHorizontal', 'beveledGingival', 'beveledOcclusal', 'ellipsoid'];

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Parse the studio's plan export ("Plan summary (JSON)" or `treatment-plan.json` inside the stage zip).
 * Throws with a readable message when the file is not a plan.
 */
export function parsePlanJson(text: string): PlanSummary {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const o = raw as Record<string, unknown>;
  if (!o || typeof o !== 'object' || !Array.isArray(o.teeth)) {
    throw new Error('Not a Smile Craft plan: expected the studio "Plan summary (JSON)" export with a "teeth" list.');
  }
  const teeth: PlanTooth[] = [];
  for (const t of o.teeth as Record<string, unknown>[]) {
    const id = num(t?.id, NaN);
    if (!isValidTooth(id)) continue;
    const atts = Array.isArray(t.attachments) ? (t.attachments as Record<string, unknown>[]) : [];
    teeth.push({
      id,
      mesial: num(t.mesial),
      buccal: num(t.buccal),
      extrusion: num(t.extrusion),
      tip: num(t.tip),
      torque: num(t.torque),
      rotation: num(t.rotation),
      startStage: num(t.startStage),
      locked: !!t.locked,
      extracted: !!t.extracted,
      attachments: atts
        .filter((a) => ATTACHMENT_TYPES.includes(a?.type as AttachmentType))
        .map((a) => ({ type: a.type as AttachmentType, stageFrom: num(a.stageFrom) })),
    });
  }
  if (!teeth.length) throw new Error('The plan contains no valid FDI tooth numbers.');
  const order = sortTeeth(teeth.map((t) => t.id));
  teeth.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const ipr: IprEntry[] = (Array.isArray(o.ipr) ? (o.ipr as Record<string, unknown>[]) : [])
    .filter((e) => typeof e?.contact === 'string' && /^\d{2}-\d{2}$/.test(e.contact as string) && num(e.amountMm) > 0)
    .map((e) => ({ contact: e.contact as string, amountMm: num(e.amountMm), stage: num(e.stage) }));

  const st = (o.stages ?? {}) as Record<string, unknown>;
  const upper = num(st.upper);
  const lower = num(st.lower);
  const total = num(st.total, Math.max(upper, lower));
  const protocol = (o.protocol ?? {}) as Record<string, unknown>;
  return {
    protocolName: typeof protocol.name === 'string' ? protocol.name : '',
    stages: { total, upper, lower, weeks: num(st.weeks, total) },
    teeth,
    ipr,
    notes: typeof o.notes === 'string' ? o.notes : '',
  };
}

/* ------------------------------------------------------------------ plan review */

export function isMoving(t: PlanTooth): boolean {
  return MOVEMENT_KEYS.some((k) => Math.abs(t[k]) > 1e-6);
}

/** Visual magnitude 0..1 combining translation (mm) and angular (°) movement for the arch chart. */
export function movementScore(t: PlanTooth): number {
  const lin = Math.hypot(t.mesial, t.buccal, t.extrusion);
  const ang = Math.max(Math.abs(t.tip), Math.abs(t.torque), Math.abs(t.rotation));
  return Math.min(1, Math.max(lin / 3, ang / 25));
}

export interface PlanFlag {
  tooth: number;
  severity: 'warning' | 'info';
  text: string;
}

export interface PlanReview {
  moving: PlanTooth[];
  attachmentCount: number;
  iprTotal: { upper: number; lower: number };
  flags: PlanFlag[];
  fitsProduct: boolean;
  suggestedProduct: ProductId | null;
  /** Rx conflicts: teeth asked not to move that move, IPR/attachments when not allowed… */
  rxConflicts: string[];
}

/** Clinical sanity review of a plan against the default protocol limits and the doctor's Rx. */
export function reviewPlan(plan: PlanSummary, c: Pick<PortalCase, 'rx'>): PlanReview {
  const protocol = defaultProtocol();
  const moving = plan.teeth.filter(isMoving);
  const flags: PlanFlag[] = [];
  for (const t of moving) {
    const lim = totalLimitsFor(protocol, t.id);
    const checks: [number, number, string][] = [
      [Math.abs(t.rotation), lim.rotationDeg, `Rotation ${Math.abs(t.rotation).toFixed(1)}°`],
      [t.extrusion, lim.extrusionMm, `Extrusion ${t.extrusion.toFixed(1)} mm`],
      [-t.extrusion, lim.intrusionMm, `Intrusion ${(-t.extrusion).toFixed(1)} mm`],
      [Math.abs(t.tip), lim.tipDeg, `Tip ${Math.abs(t.tip).toFixed(1)}°`],
      [Math.abs(t.torque), lim.torqueDeg, `Torque ${Math.abs(t.torque).toFixed(1)}°`],
      [Math.hypot(t.mesial, t.buccal), lim.translationMm, `Bodily movement ${Math.hypot(t.mesial, t.buccal).toFixed(1)} mm`],
    ];
    for (const [v, max, text] of checks) {
      if (v > max) flags.push({ tooth: t.id, severity: 'warning', text: `${text} exceeds predictable range (${max})` });
    }
    if (t.extrusion > 0.5 && !t.attachments.length && isAnterior(t.id)) {
      flags.push({ tooth: t.id, severity: 'info', text: 'Extrusion without an attachment' });
    }
  }
  const iprTotal = { upper: 0, lower: 0 };
  for (const e of plan.ipr) iprTotal[archOf(Number(e.contact.split('-')[0]))] += e.amountMm;

  const rx = c.rx;
  const rxConflicts: string[] = [];
  const movingIds = new Set(moving.map((t) => t.id));
  const dnm = rx.doNotMove.filter((id) => movingIds.has(id));
  if (dnm.length) rxConflicts.push(`Teeth marked "do not move" are moving: ${dnm.join(', ')}`);
  const attIds = plan.teeth.filter((t) => t.attachments.length).map((t) => t.id);
  if (!rx.attachmentsAllowed && attIds.length) rxConflicts.push('Rx says no attachments, but the plan has attachments');
  const badAtt = attIds.filter((id) => rx.noAttachments.includes(id));
  if (badAtt.length) rxConflicts.push(`Attachments on teeth marked "no attachments": ${badAtt.join(', ')}`);
  if (rx.ipr === 'no' && plan.ipr.length) rxConflicts.push('Rx says no IPR, but the plan includes IPR');
  if (rx.arches === 'upper' && plan.stages.lower > 0 && plan.teeth.some((t) => archOf(t.id) === 'lower' && isMoving(t))) rxConflicts.push('Rx is upper arch only, but lower teeth move');
  if (rx.arches === 'lower' && plan.stages.upper > 0 && plan.teeth.some((t) => archOf(t.id) === 'upper' && isMoving(t))) rxConflicts.push('Rx is lower arch only, but upper teeth move');

  const maxArch = Math.max(plan.stages.upper, plan.stages.lower);
  const fitsProduct = maxArch <= PRODUCTS[rx.product].maxStages;
  const suggestedProduct = fitsProduct ? null : productForStages(maxArch);

  return { moving, attachmentCount: attIds.reduce((n, id) => n + plan.teeth.find((t) => t.id === id)!.attachments.length, 0), iprTotal, flags, fitsProduct, suggestedProduct, rxConflicts };
}

/** Smallest treatment product that covers the stage count. */
export function productForStages(stages: number): ProductId {
  const order: ProductId[] = ['express', 'lite', 'moderate', 'comprehensive'];
  return order.find((p) => stages <= PRODUCTS[p].maxStages) ?? 'comprehensive';
}

export function formatMovement(t: PlanTooth, key: (typeof MOVEMENT_KEYS)[number]): string {
  const v = t[key];
  if (Math.abs(v) < 1e-6) return '';
  const meta = MOVEMENT_META[key];
  return `${Math.abs(v).toFixed(meta.unit === 'mm' ? 1 : 0)}${meta.unit === 'mm' ? '' : '°'} ${v > 0 ? meta.positive : meta.negative}`;
}

/** Estimated treatment duration in weeks for a wear schedule. */
export function treatmentWeeks(plan: PlanSummary, daysPerAligner: number): number {
  return Math.ceil((plan.stages.total * daysPerAligner) / 7);
}

/* ------------------------------------------------------------------ preferences → studio protocol */

const TRI_TEXT: Record<string, string> = { yes: 'preferred', as_needed: 'as needed', no: 'avoid' };

/** Turn the doctor's clinical preferences into a studio protocol so planning follows them by default. */
export function preferencesToProtocol(prefs: ClinicalPreferences, doctorName: string): Protocol {
  const p = defaultProtocol();
  p.name = `${doctorName} – clinical preferences`;
  p.description = `Generated from the Smile Craft Doctor Portal preferences of ${doctorName}.`;
  p.staging.daysPerStage = prefs.daysPerAligner;
  p.staging.syncArches = prefs.passiveAligners;
  p.attachments.defaultStage = Math.max(0, prefs.attachmentStage - 1);
  if (!prefs.attachmentsAllowed) p.attachments.rules = [];
  p.ipr.defaultStage = prefs.iprStage;
  if (prefs.iprAllowed) {
    p.ipr.maxPerContactMm = prefs.iprMaxPerContactMm;
    p.ipr.maxPerContactAnteriorMm = Math.min(p.ipr.maxPerContactAnteriorMm, prefs.iprMaxPerContactMm);
  } else {
    p.ipr.maxPerContactMm = 0;
    p.ipr.maxPerContactAnteriorMm = 0;
    p.ipr.maxTotalPerArchMm = 0;
  }
  p.clinicalNotes = [
    `Expansion: ${TRI_TEXT[prefs.expansion]}. Proclination: ${TRI_TEXT[prefs.proclination]}.`,
    `IPR: ${prefs.iprAllowed ? `allowed, max ${prefs.iprMaxPerContactMm} mm per contact, from aligner ${prefs.iprStage}` : 'not allowed'}.`,
    `Attachments: ${prefs.attachmentsAllowed ? `allowed, placed at aligner ${prefs.attachmentStage}` : 'not allowed'}.`,
    prefs.overcorrection ? 'Add overcorrection stages for rotations and extrusions.' : '',
    `Passive aligners on the shorter arch: ${prefs.passiveAligners ? 'yes' : 'no'}.`,
    prefs.notes,
  ]
    .filter(Boolean)
    .join('\n');
  return p;
}
