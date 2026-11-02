/**
 * Doctor-viewer package format (shared by the studio exporter and the standalone viewer).
 * A zip (fflate) with `meta.json` and binary arrays; embedded in the HTML as base64.
 */
export const DOCTOR_FORMAT = 'smile-craft/doctor-viewer@1';

export interface DoctorArchMeta {
  /** Tooth ids in the order used by `<arch>.stages` matrices. */
  teeth: number[];
  /** Position quantization: value = int16 * scale + offset (per axis). */
  scale: [number, number, number];
  offset: [number, number, number];
  vertexCount: number;
  /** Extracted teeth: plane (point, normal) the crown collapses onto from `fromStage`. */
  extracted: { id: number; point: [number, number, number]; normal: [number, number, number]; fromStage: number }[];
  attachments: { file: string; tooth: number; stageFrom: number }[];
  pontics: { file: string; id: number; stageFrom: number }[];
}

/** Exported stage models (no plan): one model per aligner stage. */
export interface SeriesArchMeta {
  stages: number;
  /**
   * Runs of consecutive stages sharing one mesh layout: files `<arch>.g<i>.idx`, `.pos0` (first stage of
   * the run), `.d<k>` (stage from+k as differences from pos0) and `.tooth` (colour classes).
   */
  groups: { from: number; count: number; vertexCount: number }[];
  scale: [number, number, number];
  offset: [number, number, number];
  /** Per-vertex colour classes (0 gingiva, 1 tooth, 2 attachment), when available. */
  colored: boolean;
  /** Original file name of each stage. */
  names: string[];
}

export interface DoctorMeta {
  format: typeof DOCTOR_FORMAT;
  /** 'plan' (default): planned in Smile Craft. 'series': exported stage models only. */
  mode?: 'plan' | 'series';
  series?: Partial<Record<'upper' | 'lower', SeriesArchMeta>>;
  doctorNotes?: string;
  createdAt: string;
  lab: { name: string; email: string; whatsapp: string };
  caseInfo: { patientName: string; caseId: string; clinician: string; notes: string };
  totalStages: number;
  archStages: { upper: number; lower: number };
  daysPerStage: number;
  colors: { gum: string; tooth: string };
  oriented: boolean;
  arches: Partial<Record<'upper' | 'lower', DoctorArchMeta>>;
  teeth: { id: number; movement: Record<string, number>; start: number; end: number; attachments: string[]; extracted: boolean }[];
  ipr: { contact: string; amountMm: number; stage: number }[];
  occlusion: { initial: Record<string, number> | null; final: Record<string, number> | null };
  planNotes: string;
}
