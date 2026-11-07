/**
 * Smile Craft Doctor Portal – domain model.
 *
 * Modelled on what dentists rely on in the leading aligner portals (Invisalign Doctor Site + ClinCheck,
 * Spark DTX Portal + Approver, ClearCorrect Doctor Portal + ClearPilot, Angel iOrtho):
 * one-page Rx with saved clinical preferences, structured records upload, a status pipeline with an
 * "action needed" queue, versioned treatment plans with approve / request-modification, per-case
 * messaging with the planning team, refinements and retainers, shipments and invoices.
 */
import type { AttachmentType, IprEntry, Movement } from '../core/types';

export type Role = 'doctor' | 'lab';

export type CaseStatus =
  | 'draft'
  | 'submitted'
  | 'records_issue'
  | 'planning'
  | 'plan_ready'
  | 'modification_requested'
  | 'approved'
  | 'manufacturing'
  | 'shipped'
  | 'in_treatment'
  | 'refinement'
  | 'retention'
  | 'completed'
  | 'cancelled';

export const STATUS_LABEL: Record<CaseStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  records_issue: 'Records needed',
  planning: 'In planning',
  plan_ready: 'Plan ready for review',
  modification_requested: 'Modification requested',
  approved: 'Approved',
  manufacturing: 'Manufacturing',
  shipped: 'Shipped',
  in_treatment: 'In treatment',
  refinement: 'Refinement',
  retention: 'Retention',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export type ProductId = 'comprehensive' | 'moderate' | 'lite' | 'express' | 'retainers';

export interface Product {
  id: ProductId;
  name: string;
  /** Maximum aligner stages per arch included (Infinity = unlimited). */
  maxStages: number;
  refinementsIncluded: string;
  /** List price in USD – placeholder values, edit to your fee schedule. */
  priceUsd: number;
  description: string;
}

export const PRODUCTS: Record<ProductId, Product> = {
  comprehensive: { id: 'comprehensive', name: 'Smile Craft Comprehensive', maxStages: Infinity, refinementsIncluded: 'Unlimited refinements for 5 years', priceUsd: 1200, description: 'Full orthodontic correction, any complexity.' },
  moderate: { id: 'moderate', name: 'Smile Craft Moderate', maxStages: 26, refinementsIncluded: '2 refinements within 2 years', priceUsd: 850, description: 'Moderate crowding/spacing, up to 26 aligners per arch.' },
  lite: { id: 'lite', name: 'Smile Craft Lite', maxStages: 14, refinementsIncluded: '1 refinement within 1 year', priceUsd: 600, description: 'Mild cases and relapse, up to 14 aligners per arch.' },
  express: { id: 'express', name: 'Smile Craft Express', maxStages: 7, refinementsIncluded: 'No refinements', priceUsd: 350, description: 'Minor anterior alignment, up to 7 aligners per arch.' },
  retainers: { id: 'retainers', name: 'Smile Craft Retainers', maxStages: 0, refinementsIncluded: '—', priceUsd: 150, description: 'Set of clear retainers (upper + lower).' },
};

export const TREATMENT_PRODUCTS: ProductId[] = ['comprehensive', 'moderate', 'lite', 'express'];

export type ArchSelection = 'both' | 'upper' | 'lower';
export type Tri = 'yes' | 'as_needed' | 'no';

export interface Prescription {
  product: ProductId;
  arches: ArchSelection;
  chiefComplaint: string;
  apRight: 'maintain' | 'improve' | 'class1';
  apLeft: 'maintain' | 'improve' | 'class1';
  overjet: 'maintain' | 'improve' | 'ideal';
  overbite: 'maintain' | 'correct_deep' | 'correct_open';
  midline: 'maintain' | 'improve_upper' | 'improve_lower' | 'improve_both';
  posteriorCrossbite: 'none' | 'correct' | 'maintain';
  expand: Tri;
  procline: Tri;
  ipr: Tri;
  attachmentsAllowed: boolean;
  doNotMove: number[];
  noAttachments: number[];
  extract: number[];
  notes: string;
}

export interface Patient {
  firstName: string;
  lastName: string;
  dob: string;
  sex: 'F' | 'M' | 'X';
  /** Optional practice chart number. */
  chartNumber: string;
}

export type RecordKind = 'photo' | 'xray' | 'scan' | 'file';

export interface RecordSlotDef {
  slot: string;
  label: string;
  kind: RecordKind;
  required: boolean;
  accept: string;
}

/** Standard orthodontic record set (8 photos, 2 radiographs, 2 scans). */
export const RECORD_SLOTS: RecordSlotDef[] = [
  { slot: 'face_profile', label: 'Profile', kind: 'photo', required: true, accept: 'image/*' },
  { slot: 'face_front', label: 'Frontal – rest', kind: 'photo', required: true, accept: 'image/*' },
  { slot: 'face_smile', label: 'Frontal – smile', kind: 'photo', required: true, accept: 'image/*' },
  { slot: 'io_upper', label: 'Upper occlusal', kind: 'photo', required: true, accept: 'image/*' },
  { slot: 'io_lower', label: 'Lower occlusal', kind: 'photo', required: true, accept: 'image/*' },
  { slot: 'io_right', label: 'Right buccal', kind: 'photo', required: true, accept: 'image/*' },
  { slot: 'io_front', label: 'Anterior', kind: 'photo', required: true, accept: 'image/*' },
  { slot: 'io_left', label: 'Left buccal', kind: 'photo', required: true, accept: 'image/*' },
  { slot: 'xr_pano', label: 'Panoramic', kind: 'xray', required: false, accept: 'image/*,.dcm' },
  { slot: 'xr_ceph', label: 'Cephalometric', kind: 'xray', required: false, accept: 'image/*,.dcm' },
  { slot: 'scan_upper', label: 'Upper scan', kind: 'scan', required: true, accept: '.stl,.ply,.obj' },
  { slot: 'scan_lower', label: 'Lower scan', kind: 'scan', required: true, accept: '.stl,.ply,.obj' },
];

export interface RecordFile {
  id: string;
  slot: string;
  kind: RecordKind;
  name: string;
  size: number;
  mime: string;
  uploadedAt: string;
  uploadedBy: Role;
  /** Set when the blob is kept in IndexedDB (demo seed records have no blob). */
  hasBlob: boolean;
}

/** Studio plan export (`treatment-plan.json` / "Plan summary (JSON)") as consumed by the portal. */
export interface PlanTooth extends Movement {
  id: number;
  startStage: number;
  locked: boolean;
  extracted: boolean;
  attachments: { type: AttachmentType; stageFrom: number }[];
}

export interface PlanSummary {
  protocolName: string;
  stages: { total: number; upper: number; lower: number; weeks: number };
  teeth: PlanTooth[];
  ipr: IprEntry[];
  notes: string;
}

export type PlanVersionStatus = 'pending' | 'approved' | 'modification_requested' | 'superseded';

export interface ToothComment {
  tooth: number;
  text: string;
}

export interface PlanVersion {
  id: string;
  version: number;
  createdAt: string;
  designer: string;
  summary: PlanSummary;
  labNotes: string;
  status: PlanVersionStatus;
  decidedAt?: string;
  doctorComment?: string;
  toothComments?: ToothComment[];
  /** Record id of an attached `.smile` studio project (open in the 3D studio). */
  projectFileId?: string;
  /** Refinement number this plan belongs to (0 = initial). */
  phase: number;
}

export interface Message {
  id: string;
  at: string;
  from: Role;
  author: string;
  text: string;
  readBy: Role[];
}

export interface Shipment {
  id: string;
  createdAt: string;
  carrier: string;
  tracking: string;
  contents: string;
  delivered: boolean;
}

export interface Invoice {
  id: string;
  number: string;
  date: string;
  description: string;
  amountUsd: number;
  paid: boolean;
}

export interface CaseEvent {
  at: string;
  by: Role;
  text: string;
}

export interface PortalCase {
  id: string;
  /** Human case number, e.g. SC-2026-0007. */
  number: string;
  createdAt: string;
  updatedAt: string;
  status: CaseStatus;
  patient: Patient;
  rx: Prescription;
  records: RecordFile[];
  plans: PlanVersion[];
  messages: Message[];
  shipments: Shipment[];
  invoices: Invoice[];
  events: CaseEvent[];
  /** Number of refinements ordered so far. */
  refinements: number;
  /** Aligner the patient currently wears (doctor-reported). */
  currentAligner?: number;
  starred?: boolean;
}

export interface ClinicalPreferences {
  defaultProduct: ProductId;
  attachmentsAllowed: boolean;
  attachmentStage: number;
  iprAllowed: boolean;
  iprMaxPerContactMm: number;
  iprStage: number;
  daysPerAligner: number;
  passiveAligners: boolean;
  expansion: Tri;
  proclination: Tri;
  overcorrection: boolean;
  defaultRetention: 'vivera_like' | 'fixed_lingual' | 'both' | 'none';
  /** Free-text clinical rules, sent with every case and to the planning protocol. */
  notes: string;
}

export interface Address {
  id: string;
  label: string;
  line: string;
  city: string;
  country: string;
  phone: string;
}

export interface DoctorAccount {
  name: string;
  email: string;
  practice: string;
  addresses: Address[];
}

export interface PortalDb {
  schema: 1;
  doctor: DoctorAccount;
  preferences: ClinicalPreferences;
  cases: PortalCase[];
  counter: number;
}

export function defaultPreferences(): ClinicalPreferences {
  return {
    defaultProduct: 'comprehensive',
    attachmentsAllowed: true,
    attachmentStage: 1,
    iprAllowed: true,
    iprMaxPerContactMm: 0.5,
    iprStage: 1,
    daysPerAligner: 7,
    passiveAligners: true,
    expansion: 'as_needed',
    proclination: 'as_needed',
    overcorrection: false,
    defaultRetention: 'vivera_like',
    notes: '',
  };
}

export function emptyRx(prefs: ClinicalPreferences): Prescription {
  return {
    product: prefs.defaultProduct,
    arches: 'both',
    chiefComplaint: '',
    apRight: 'maintain',
    apLeft: 'maintain',
    overjet: 'maintain',
    overbite: 'maintain',
    midline: 'maintain',
    posteriorCrossbite: 'none',
    expand: prefs.expansion,
    procline: prefs.proclination,
    ipr: prefs.iprAllowed ? 'as_needed' : 'no',
    attachmentsAllowed: prefs.attachmentsAllowed,
    doNotMove: [],
    noAttachments: [],
    extract: [],
    notes: '',
  };
}

export function patientName(p: Patient): string {
  return `${p.firstName} ${p.lastName}`.trim() || 'Unnamed patient';
}
