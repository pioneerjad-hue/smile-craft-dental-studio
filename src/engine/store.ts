import { create } from 'zustand';
import type { Arch } from '../core/fdi';
import { defaultProtocol } from '../core/protocol';
import type { StagingResult } from '../core/staging';
import type { CaseInfo, ContactReport, Issue, Measurement, Protocol, ToothFrame, TreatmentPlan } from '../core/types';

export type Step = 'import' | 'orient' | 'segment' | 'axes' | 'plan' | 'stage' | 'protocol' | 'export';
export type Tool = 'orbit' | 'seed' | 'brushAdd' | 'brushErase' | 'measure' | 'select' | 'orientPoints' | 'missing';
export type View = 'front' | 'right' | 'left' | 'upperOcclusal' | 'lowerOcclusal';

export interface ArchInfo {
  fileName: string;
  vertices: number;
  faces: number;
}

export interface Settings {
  brushRadiusMm: number;
  seedReachScale: number;
  segTightness: number;
  autoAdvance: boolean;
  showUpper: boolean;
  showLower: boolean;
  showGhost: boolean;
  showAxes: boolean;
  showAttachments: boolean;
  gingivaFlexMm: number;
}

export type LayerId = 'upperGum' | 'upperTeeth' | 'upperBase' | 'upperRoots' | 'lowerGum' | 'lowerTeeth' | 'lowerBase' | 'lowerRoots';
export interface LayerStyle {
  visible: boolean;
  opacity: number;
  color: string;
}
export const LAYER_LABEL: Record<LayerId, string> = {
  upperGum: 'Gingiva',
  upperTeeth: 'Teeth',
  upperBase: 'Model base',
  upperRoots: 'Roots',
  lowerGum: 'Gingiva',
  lowerTeeth: 'Teeth',
  lowerBase: 'Model base',
  lowerRoots: 'Roots',
};

export interface ModelBuilder {
  enabled: boolean;
  thicknessMm: number;
  /** Engrave "<case> U07" into each model's base. */
  label: boolean;
  /** Show and export aligner trim lines. */
  trimLines: boolean;
  trimOffsetMm: number;
}

export interface BaseReport {
  openEdges: number;
  holesFilled: number;
  borderVertices: number;
  labelPlaced?: boolean;
}

export interface StudioState {
  step: Step;
  caseInfo: CaseInfo;
  arches: Record<Arch, ArchInfo | null>;
  teeth: number[];
  frames: Record<number, ToothFrame>;
  plan: TreatmentPlan;
  protocol: Protocol;
  staging: StagingResult | null;
  issues: Issue[];
  contacts: ContactReport[] | null;
  contactsStale: boolean;
  stage: number;
  playing: boolean;
  activeTooth: number;
  selectedTooth: number | null;
  tool: Tool;
  settings: Settings;
  measurements: Measurement[];
  busy: string | null;
  toast: { text: string; kind: 'info' | 'error' | 'success'; at: number } | null;
  aiRationale: string | null;
  layers: Record<LayerId, LayerStyle>;
  modelBuilder: ModelBuilder;
  baseReport: Partial<Record<Arch, BaseReport>>;
  /** Teeth marked absent before segmentation (default: third molars). */
  missingTeeth: number[];
  oriented: boolean;
  /** Landmark clicks collected by the 3-point orientation tool. */
  orientPoints: number;
}

export function emptyPlan(): TreatmentPlan {
  return { teeth: {}, ipr: [], notes: '' };
}

export function emptyCase(): CaseInfo {
  return { patientName: '', caseId: '', clinician: '', notes: '', createdAt: new Date().toISOString() };
}

export const useStudio = create<StudioState>(() => ({
  step: 'import',
  caseInfo: emptyCase(),
  arches: { upper: null, lower: null },
  teeth: [],
  frames: {},
  plan: emptyPlan(),
  protocol: defaultProtocol(),
  staging: null,
  issues: [],
  contacts: null,
  contactsStale: true,
  stage: 0,
  playing: false,
  activeTooth: 17,
  selectedTooth: null,
  tool: 'orbit',
  settings: {
    brushRadiusMm: 1.2,
    seedReachScale: 1,
    segTightness: 0,
    autoAdvance: true,
    showUpper: true,
    showLower: true,
    showGhost: false,
    showAxes: true,
    showAttachments: true,
    gingivaFlexMm: 4,
  },
  measurements: [],
  busy: null,
  toast: null,
  aiRationale: null,
  layers: {
    upperGum: { visible: true, opacity: 1, color: '#de8f99' },
    upperTeeth: { visible: true, opacity: 1, color: '#f5f0e0' },
    upperBase: { visible: true, opacity: 1, color: '#c9d3e0' },
    upperRoots: { visible: false, opacity: 1, color: '#e8d9b5' },
    lowerGum: { visible: true, opacity: 1, color: '#de8f99' },
    lowerTeeth: { visible: true, opacity: 1, color: '#f5f0e0' },
    lowerBase: { visible: true, opacity: 1, color: '#c9d3e0' },
    lowerRoots: { visible: false, opacity: 1, color: '#e8d9b5' },
  },
  modelBuilder: { enabled: false, thicknessMm: 3, label: true, trimLines: false, trimOffsetMm: 1.5 },
  baseReport: {},
  missingTeeth: [18, 28, 38, 48],
  oriented: false,
  orientPoints: 0,
}));

export const getState = useStudio.getState;
export const setState = useStudio.setState;

export function toast(text: string, kind: 'info' | 'error' | 'success' = 'info') {
  setState({ toast: { text, kind, at: Date.now() } });
}
