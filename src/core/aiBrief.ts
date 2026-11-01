import { archOf, shortLabel, sortTeeth, toothName, toothType } from './fdi';
import { bolton, spaceAnalysis, toothWidth } from './analysis';
import type { StagingResult } from './staging';
import type {
  Attachment,
  AttachmentType,
  CaseInfo,
  ContactReport,
  Movement,
  Protocol,
  ToothFrame,
  TreatmentPlan,
} from './types';
import { MOVEMENT_KEYS, zeroMovement } from './types';
import { constrainMovement } from './constraints';

/**
 * A structured, self-describing package of everything an AI planner needs to propose a plan that
 * follows the clinician's protocol. The AI answers with an `AiPlanResponse` JSON, which the studio
 * imports, validates against the protocol and shows for approval — the clinician always signs off.
 */
export function buildPlanningBrief(args: {
  caseInfo: CaseInfo;
  protocol: Protocol;
  plan: TreatmentPlan;
  frames: Record<number, ToothFrame>;
  staging: StagingResult | null;
  contacts: ContactReport[] | null;
}) {
  const { caseInfo, protocol, plan, frames, staging, contacts } = args;
  const ids = sortTeeth(Object.keys(frames).map(Number));
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    format: 'smile-craft/planning-brief@1',
    generatedAt: new Date().toISOString(),
    case: { caseId: caseInfo.caseId, clinician: caseInfo.clinician, notes: caseInfo.notes },
    conventions: {
      numbering: 'FDI',
      units: { translation: 'mm', angles: 'degrees' },
      movementFrame:
        'Per-tooth clinical frame: mesial axis tangent to the arch, buccal axis in the occlusal plane, occlusal axis normal to the occlusal plane. Rotations are about the estimated centre of rotation (pivot).',
      signs: {
        mesial: '+ mesial / - distal',
        buccal: '+ buccal (labial) / - lingual (palatal)',
        extrusion: '+ extrusion / - intrusion',
        tip: '+ crown tips mesially',
        torque: '+ crown torques buccally (root lingual)',
        rotation: '+ mesial surface rotates lingually (mesial-in)',
      },
    },
    protocol,
    teeth: ids.map((id) => {
      const f = frames[id];
      const tp = plan.teeth[id];
      return {
        id,
        label: shortLabel(id),
        name: toothName(id),
        arch: archOf(id),
        type: toothType(id),
        widthMm: r(toothWidth(plan, frames, id) ?? 0),
        crownHeightMm: r(f.crownHeightMm),
        centroid: f.centroid.map(r),
        axes: { mesial: f.mesial.map(r), buccal: f.buccal.map(r), occlusal: f.occlusal.map(r) },
        locked: !!tp?.locked,
        lockedAxes: tp?.lockedAxes ?? [],
        extracted: !!tp?.extracted,
        currentPlan: tp ? tp.movement : zeroMovement(),
        attachments: tp?.attachments.map((a) => a.type) ?? [],
      };
    }),
    contacts: contacts?.map((c) => ({ contact: c.contact, stage: c.stage, distanceMm: r(c.distanceMm) })) ?? [],
    analysis: {
      boltonAnterior: bolton(plan, frames, 'anterior'),
      boltonOverall: bolton(plan, frames, 'overall'),
      spaceUpper: spaceAnalysis('upper', plan, frames),
      spaceLower: spaceAnalysis('lower', plan, frames),
    },
    currentStaging: staging ? { totalStages: staging.totalStages, archStages: staging.archStages } : null,
    responseFormat: {
      description:
        'Reply with JSON only: {"format":"smile-craft/ai-plan@1","rationale":string,"teeth":{"<FDI>":{"mesial":n,"buccal":n,"extrusion":n,"tip":n,"torque":n,"rotation":n,"startStage"?:n,"attachments"?:AttachmentType[]}},"ipr":[{"contact":"a-b","amountMm":n,"stage":n}]}. Movements are TOTAL movements from the initial position. Omit teeth that do not move.',
      attachmentTypes: ['rectangularVertical', 'rectangularHorizontal', 'beveledGingival', 'beveledOcclusal', 'ellipsoid'],
    },
  };
}

export interface AiPlanResponse {
  format: 'smile-craft/ai-plan@1';
  rationale?: string;
  teeth: Record<string, Partial<Movement> & { startStage?: number; attachments?: AttachmentType[] }>;
  ipr?: { contact: string; amountMm: number; stage?: number }[];
}

const ATTACHMENT_TYPES = new Set<AttachmentType>([
  'rectangularVertical',
  'rectangularHorizontal',
  'beveledGingival',
  'beveledOcclusal',
  'ellipsoid',
]);

export function defaultAttachmentSize(type: AttachmentType): [number, number, number] {
  switch (type) {
    case 'rectangularVertical':
      return [2, 3, 1];
    case 'rectangularHorizontal':
      return [3, 2, 1];
    case 'beveledGingival':
    case 'beveledOcclusal':
      return [3, 2, 1.25];
    case 'ellipsoid':
      return [2.5, 2.5, 1];
  }
}

export function newAttachment(type: AttachmentType, stageFrom: number, reason?: string): Attachment {
  return {
    id: Math.random().toString(36).slice(2, 10),
    type,
    stageFrom,
    offsetMesialMm: 0,
    offsetOcclusalMm: type === 'beveledGingival' ? 0.5 : 0,
    size: defaultAttachmentSize(type),
    reason,
  };
}

/**
 * Apply an AI plan response to the current plan. Returns the new plan plus any problems found
 * while parsing (unknown teeth, bad numbers). Protocol validation happens afterwards as usual.
 */
export function applyAiPlan(
  plan: TreatmentPlan,
  response: unknown,
  presentTeeth: number[],
  protocol: Protocol,
): { plan: TreatmentPlan; problems: string[]; rationale?: string } {
  const problems: string[] = [];
  const res = response as AiPlanResponse;
  if (!res || typeof res !== 'object' || typeof res.teeth !== 'object') {
    return { plan, problems: ['Response is not a smile-craft/ai-plan@1 object with a "teeth" map.'] };
  }
  const next: TreatmentPlan = structuredClone(plan);
  const present = new Set(presentTeeth);
  for (const [key, value] of Object.entries(res.teeth)) {
    const id = Number(key);
    if (!present.has(id)) {
      problems.push(`Tooth ${key} is not segmented in this case — ignored.`);
      continue;
    }
    const tp = next.teeth[id];
    for (const k of MOVEMENT_KEYS) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        problems.push(`Tooth ${id}: ${k} is not a number — ignored.`);
        continue;
      }
      tp.movement[k] = v;
    }
    const c = constrainMovement(protocol, tp, tp.movement);
    tp.movement = c.movement;
    problems.push(...c.notes);
    if (typeof value.startStage === 'number' && value.startStage >= 0) tp.startStage = Math.floor(value.startStage);
    for (const type of value.attachments ?? []) {
      if (!ATTACHMENT_TYPES.has(type)) problems.push(`Tooth ${id}: unknown attachment "${type}".`);
      else if (!tp.attachments.some((a) => a.type === type))
        tp.attachments.push(newAttachment(type, protocol.attachments.defaultStage, 'AI'));
    }
  }
  if (Array.isArray(res.ipr)) {
    for (const e of res.ipr) {
      const [a, b] = String(e.contact).split('-').map(Number);
      if (!present.has(a) || !present.has(b) || typeof e.amountMm !== 'number') {
        problems.push(`IPR entry ${JSON.stringify(e)} is invalid — ignored.`);
        continue;
      }
      next.ipr = next.ipr.filter((x) => x.contact !== e.contact);
      next.ipr.push({ contact: e.contact, amountMm: e.amountMm, stage: e.stage ?? protocol.ipr.defaultStage });
    }
  }
  return { plan: next, problems, rationale: res.rationale };
}
