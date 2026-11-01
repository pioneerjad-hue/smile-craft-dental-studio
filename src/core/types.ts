import type { ToothType } from './fdi';

export type Vec3 = [number, number, number];

/**
 * Six-degree-of-freedom tooth movement expressed in the tooth's local clinical frame.
 * Sign conventions (all independent of quadrant):
 *  - mesial    (mm)  + = mesial,              - = distal
 *  - buccal    (mm)  + = buccal / labial,     - = lingual / palatal
 *  - extrusion (mm)  + = extrusion,           - = intrusion
 *  - tip       (deg) + = crown tips mesially  (angulation)
 *  - torque    (deg) + = crown torques buccally/labially (root lingual)
 *  - rotation  (deg) + = mesial surface rotates lingually (mesio-lingual / "mesial-in")
 */
export interface Movement {
  mesial: number;
  buccal: number;
  extrusion: number;
  tip: number;
  torque: number;
  rotation: number;
}

export type MovementKey = keyof Movement;

export const MOVEMENT_KEYS: MovementKey[] = ['mesial', 'buccal', 'extrusion', 'tip', 'torque', 'rotation'];

export const MOVEMENT_META: Record<
  MovementKey,
  { label: string; unit: 'mm' | '°'; positive: string; negative: string; step: number }
> = {
  mesial: { label: 'Mesial / Distal', unit: 'mm', positive: 'Mesial', negative: 'Distal', step: 0.1 },
  buccal: { label: 'Buccal / Lingual', unit: 'mm', positive: 'Buccal', negative: 'Lingual', step: 0.1 },
  extrusion: { label: 'Extrusion / Intrusion', unit: 'mm', positive: 'Extrusion', negative: 'Intrusion', step: 0.1 },
  tip: { label: 'Tip (angulation)', unit: '°', positive: 'Mesial crown', negative: 'Distal crown', step: 0.5 },
  torque: { label: 'Torque (inclination)', unit: '°', positive: 'Buccal crown', negative: 'Lingual crown', step: 0.5 },
  rotation: { label: 'Rotation', unit: '°', positive: 'Mesial-in', negative: 'Distal-in', step: 0.5 },
};

export function zeroMovement(): Movement {
  return { mesial: 0, buccal: 0, extrusion: 0, tip: 0, torque: 0, rotation: 0 };
}

export function isZeroMovement(m: Movement, eps = 1e-6): boolean {
  return MOVEMENT_KEYS.every((k) => Math.abs(m[k]) < eps);
}

/** Local clinical frame of a tooth, computed from the initial (stage 0) scan. */
export interface ToothFrame {
  id: number;
  /** Area-weighted crown centroid (mm, scan coordinates). */
  centroid: Vec3;
  /** Unit vector pointing mesially, tangent to the arch, in the occlusal plane. */
  mesial: Vec3;
  /** Unit vector pointing buccally / labially, in the occlusal plane. */
  buccal: Vec3;
  /** Unit vector pointing occlusally (towards the opposing arch). */
  occlusal: Vec3;
  /** Estimated centre of rotation (crown centroid shifted apically). */
  pivot: Vec3;
  /** Crown mesio-distal width measured from the mesh along the mesial axis (mm). */
  autoWidthMm: number;
  /** Crown height along the occlusal axis (mm). */
  crownHeightMm: number;
}

export type AttachmentType =
  | 'rectangularVertical'
  | 'rectangularHorizontal'
  | 'beveledGingival'
  | 'beveledOcclusal'
  | 'ellipsoid';

export const ATTACHMENT_LABEL: Record<AttachmentType, string> = {
  rectangularVertical: 'Rectangular – vertical',
  rectangularHorizontal: 'Rectangular – horizontal',
  beveledGingival: 'Beveled – gingival',
  beveledOcclusal: 'Beveled – occlusal',
  ellipsoid: 'Ellipsoid',
};

export interface Attachment {
  id: string;
  type: AttachmentType;
  /** Stage from which the attachment is present on the models (0 = attachment template). */
  stageFrom: number;
  /** Placement offsets from the crown centre on the buccal surface (mm). */
  offsetOcclusalMm: number;
  offsetMesialMm: number;
  /** Size along mesial, occlusal and buccal (thickness) axes (mm). */
  size: [number, number, number];
  /** Why it was added (manual or a protocol rule id). */
  reason?: string;
}

export interface ToothPlan {
  id: number;
  movement: Movement;
  /** First stage (aligner) at which this tooth begins moving. 0 = from the first aligner. */
  startStage: number;
  /** Clinician-measured mesio-distal width, overrides the automatic value. */
  manualWidthMm?: number;
  attachments: Attachment[];
  /** Tooth must not be moved (e.g. implant, ankylosed, bridge abutment). */
  locked?: boolean;
  /** Tooth is planned for extraction / missing. */
  extracted?: boolean;
  note?: string;
}

export interface IprEntry {
  /** Contact key "a-b" (arch-sequence order). */
  contact: string;
  amountMm: number;
  /** IPR is performed before this aligner stage is delivered. */
  stage: number;
}

export interface TreatmentPlan {
  teeth: Record<number, ToothPlan>;
  ipr: IprEntry[];
  notes: string;
}

export interface CaseInfo {
  patientName: string;
  caseId: string;
  clinician: string;
  notes: string;
  createdAt: string;
}

export interface StageLimits {
  translationMm: number;
  extrusionMm: number;
  intrusionMm: number;
  tipDeg: number;
  torqueDeg: number;
  rotationDeg: number;
  /** Maximum displacement of any crown point between consecutive stages. */
  crownDisplacementMm: number;
}

export type ToothTypeOverrides<T> = Partial<Record<ToothType, Partial<T>>>;

export interface TotalLimits {
  translationMm: number;
  extrusionMm: number;
  intrusionMm: number;
  tipDeg: number;
  torqueDeg: number;
  rotationDeg: number;
}

export type AttachmentTrigger = 'rotation' | 'extrusion' | 'intrusion' | 'tip' | 'torque' | 'translation';

export interface AttachmentRule {
  id: string;
  description: string;
  trigger: AttachmentTrigger;
  toothTypes: ToothType[];
  /** Absolute threshold in mm or degrees depending on trigger. */
  threshold: number;
  attachment: AttachmentType;
}

export interface Protocol {
  name: string;
  version: number;
  description: string;
  staging: {
    /** synchronized: every tooth finishes on the last stage; maxRate: each tooth moves at its maximum rate then stops. */
    mode: 'synchronized' | 'maxRate';
    limits: StageLimits;
    overrides: ToothTypeOverrides<StageLimits>;
    /** Give both arches the same number of aligners (passive aligners on the shorter arch). */
    syncArches: boolean;
    daysPerStage: number;
    maxStages: number;
  };
  biomechanics: {
    /** Distance from crown centroid to estimated centre of rotation along the long axis (mm). */
    pivotApicalMm: Record<ToothType, number>;
  };
  totalLimits: TotalLimits & { overrides: ToothTypeOverrides<TotalLimits> };
  ipr: {
    maxPerContactMm: number;
    maxPerContactAnteriorMm: number;
    maxTotalPerArchMm: number;
    stepMm: number;
    defaultStage: number;
    /** Overlap smaller than this is considered a normal tight contact. */
    overlapToleranceMm: number;
  };
  attachments: {
    rules: AttachmentRule[];
    defaultStage: number;
  };
  /** Free-text clinical rules — read by the AI planner. */
  clinicalNotes: string;
}

export interface Issue {
  severity: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
  tooth?: number;
  contact?: string;
}

export interface ContactReport {
  contact: string;
  a: number;
  b: number;
  stage: number;
  /** Signed surface distance: negative = overlap (collision), positive = gap. */
  distanceMm: number;
}

export interface Measurement {
  id: string;
  a: Vec3;
  b: Vec3;
  label: string;
}
