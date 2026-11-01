import { create } from 'zustand';
import type { Arch } from '../core/fdi';
import { defaultProtocol } from '../core/protocol';
import type { StagingResult } from '../core/staging';
import type { CaseInfo, ContactReport, Issue, Measurement, Protocol, ToothFrame, TreatmentPlan } from '../core/types';

export type Step = 'import' | 'segment' | 'plan' | 'stage' | 'protocol' | 'export';
export type Tool = 'orbit' | 'seed' | 'brushAdd' | 'brushErase' | 'measure' | 'select';
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

export type LayerId = 'upperGum' | 'upperTeeth' | 'upperBase' | 'lowerGum' | 'lowerTeeth' | 'lowerBase';
export interface LayerStyle {
  visible: boolean;
  opacity: number;
  color: string;
}
export const LAYER_LABEL: Record<LayerId, string> = {
  upperGum: 'Gingiva',
  upperTeeth: 'Teeth',
  upperBase: 'Model base',
  lowerGum: 'Gingiva',
  lowerTeeth: 'Teeth',
  lowerBase: 'Model base',
};

export interface ModelBuilder {
  enabled: boolean;
  thicknessMm: number;
}

export interface BaseReport {
  openEdges: number;
  holesFilled: number;
  borderVertices: number;
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
    gingivaFlexMm: 3,
  },
  measurements: [],
  busy: null,
  toast: null,
  aiRationale: null,
  layers: {
    upperGum: { visible: true, opacity: 1, color: '#de8f99' },
    upperTeeth: { visible: true, opacity: 1, color: '#f5f0e0' },
    upperBase: { visible: true, opacity: 1, color: '#c9d3e0' },
    lowerGum: { visible: true, opacity: 1, color: '#de8f99' },
    lowerTeeth: { visible: true, opacity: 1, color: '#f5f0e0' },
    lowerBase: { visible: true, opacity: 1, color: '#c9d3e0' },
  },
  modelBuilder: { enabled: false, thicknessMm: 3 },
  baseReport: {},
}));

export const getState = useStudio.getState;
export const setState = useStudio.setState;

export function toast(text: string, kind: 'info' | 'error' | 'success' = 'info') {
  setState({ toast: { text, kind, at: Date.now() } });
}
