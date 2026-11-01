import { BufferAttribute, BufferGeometry, Color, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Arch } from '../core/fdi';
import { adjacentPairs, archOf, contactKey, contralateral, sequence, toothNumber } from '../core/fdi';
import { computeStaging, movementAtStage } from '../core/staging';
import type { StagingToothInput } from '../core/staging';
import { movementMatrix, v3 } from '../core/transform';
import type { Attachment, AxisCorrection, ContactReport, Issue, Movement, MovementKey, Protocol, ToothFrame, ToothPlan, TreatmentPlan } from '../core/types';
import { isZeroMovement, zeroMovement } from '../core/types';
import { suggestIpr, triggeredAttachmentRules, validatePlan } from '../core/validate';
import { newAttachment } from '../core/aiBrief';
import { constrainMovement } from '../core/constraints';
import { buildModelBase, openEdgeCount } from '../geometry/modelBase';
import { estimatePatientFrame, frameFromLandmarks, frameToMatrix } from '../geometry/orient';
import { autoSegmentSeeds } from '../geometry/autoSegment';
import { buildRootGeometry, segmentDistance } from '../geometry/roots';
import { fillSmallHoles, removeSmallComponents, toGeometry, trimByPlane } from '../geometry/repair';
import { gumDistanceToTeeth, trimLine } from '../geometry/trimLine';
import { occlusionMetrics } from '../geometry/occlusion';
import type { OcclusionMetrics } from '../geometry/occlusion';
import type { Mesh as RawMesh } from '../geometry/repair';
import type { ModelBase } from '../geometry/modelBase';
import { archOcclusalNormal } from '../geometry/frames';
import { ArchModel, crownHeightLimitMm, seedRadiusMm } from '../geometry/archModel';
import { attachmentGeometry } from '../geometry/attachments';
import { ToothBody, contactDistance } from '../geometry/contacts';
import { makeDemoArch } from '../geometry/demo';
import { computeArchFrames, crownSamples } from '../geometry/frames';
import { parseScan, writeBinaryStl } from '../geometry/io';
import { COLORS, Viewer } from './viewer';
import type { GizmoHandle, Hit, PatientAxes } from './viewer';
import { emptyPlan, getState, setState, toast, useStudio } from './store';
import type { View } from './store';

type Snapshot =
  | { kind: 'plan'; plan: TreatmentPlan }
  | { kind: 'seg'; arch: Arch; seeds: { v: number; tooth: number }[]; paint: Uint8Array; labels: Uint8Array };

const ARCHES: Arch[] = ['upper', 'lower'];

function toothHue(id: number): Color {
  const order = [...sequence('upper'), ...sequence('lower')].indexOf(id);
  const c = new Color();
  c.setHSL(((order * 0.37) % 1 + 1) % 1, 0.55, 0.72);
  return c;
}

export class Studio {
  viewer: Viewer | null = null;
  models: Partial<Record<Arch, ArchModel>> = {};
  raw: Partial<Record<Arch, { buffer: ArrayBuffer; fileName: string }>> = {};
  private bodies = new Map<number, ToothBody>();
  private samples = new Map<number, [number, number, number][]>();
  private attachmentMeshes = new Map<string, Mesh>();
  private attachmentMaterial = new MeshStandardMaterial({ color: 0x9fd3ff, roughness: 0.35, metalness: 0.05 });
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private recomputeQueued = false;
  private framesQueued = false;
  private playTimer: number | null = null;
  private pendingMeasure: Vector3 | null = null;
  private strokeSnapshot = false;
  /** Scanner → patient coordinates (applied to every scan, saved with the project). */
  orientation = new Matrix4();
  private landmarks: Vector3[] = [];
  private rootMeshes = new Map<number, Mesh>();
  private rootMaterials: Record<Arch, MeshStandardMaterial> = {
    upper: new MeshStandardMaterial({ color: 0xe8d9b5, roughness: 0.6 }),
    lower: new MeshStandardMaterial({ color: 0xe8d9b5, roughness: 0.6 }),
  };
  private gizmoStart: { id: number; key: MovementKey; value: number } | null = null;
  private axisDrag: { id: number; key: 'tip' | 'torque' | 'rotation'; start: AxisCorrection; axis: Vector3; delta: number } | null = null;
  onChange: () => void = () => {};

  constructor() {
    useStudio.subscribe((s, prev) => {
      if (s.plan !== prev.plan || s.protocol !== prev.protocol || s.frames !== prev.frames) {
        this.scheduleRecompute();
        if (s.plan !== prev.plan || s.frames !== prev.frames) setState({ contactsStale: true });
      }
      if (s.protocol.biomechanics !== prev.protocol.biomechanics) this.scheduleFrames();
      if (s.stage !== prev.stage) this.applyStage();
      if (s.selectedTooth !== prev.selectedTooth || s.step !== prev.step) {
        this.updateColors();
        this.updateAxes();
        this.updateLabels();
        this.viewer?.setGuides(s.step === 'orient');
      }
      if (s.plan !== prev.plan) {
        const ext = (p: TreatmentPlan) => Object.values(p.teeth).filter((t) => t.extracted).map((t) => t.id).join(',');
        if (ext(s.plan) !== ext(prev.plan)) {
          this.rebuildLayerIndices();
          this.updateColors();
        }
        if (s.plan.pontics !== prev.plan.pontics) this.rebuildPontics();
      }
      if (s.frames !== prev.frames) {
        this.rebuildRoots();
        this.updateLabels();
      }
      if (s.settings !== prev.settings) {
        this.applySettings(prev.settings.gingivaFlexMm !== s.settings.gingivaFlexMm);
        if (s.settings.showUpper !== prev.settings.showUpper || s.settings.showLower !== prev.settings.showLower) this.updateLabels();
      }
      if (s.layers !== prev.layers) {
        this.applyLayers();
        this.updateRootMeshes();
        const colorChanged = (['upperGum', 'upperTeeth', 'lowerGum', 'lowerTeeth'] as const).some((k) => s.layers[k].color !== prev.layers[k].color);
        if (colorChanged) this.updateColors();
      }
      if (s.modelBuilder !== prev.modelBuilder || (s.frames !== prev.frames && s.modelBuilder.enabled)) this.rebuildBases();
      if (s.modelBuilder !== prev.modelBuilder || s.stage !== prev.stage || s.step !== prev.step || s.plan !== prev.plan || s.frames !== prev.frames) this.updateTrimLines();
      if (s.tool !== prev.tool) this.applyTool();
      if (s.measurements !== prev.measurements) this.viewer?.setMeasurements(s.measurements, this.pendingMeasure);
      if (s.playing !== prev.playing) this.updatePlayback();
      this.onChange();
    });
  }

  // ───────────────────────────── viewer lifecycle ─────────────────────────────
  mount(container: HTMLElement) {
    if (this.viewer) return;
    const v = new Viewer(container);
    this.viewer = v;
    v.onClick = (hit, ev) => this.handleClick(hit, ev);
    v.onPaint = (hit, phase) => this.handlePaint(hit, phase);
    v.onGizmo = (h, d, phase) => this.handleGizmo(h, d, phase);
    v.setGuides(getState().step === 'orient');
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (m) v.setArchGeometry(arch, m.geometry, null);
    }
    this.rebuildGhosts();
    this.rebuildLayerIndices();
    this.rebuildBases();
    this.rebuildRoots();
    this.rebuildPontics();
    this.updateLabels();
    this.applySettings(false);
    this.applyTool();
    this.updateColors();
    this.applyStage();
    if (this.models.upper || this.models.lower) this.setView('front');
  }

  unmount() {
    this.viewer?.dispose();
    this.viewer = null;
  }

  // ───────────────────────────── loading ─────────────────────────────
  async loadScanFile(arch: Arch, file: File) {
    const buffer = await file.arrayBuffer();
    this.loadScanBuffer(arch, buffer, file.name);
  }

  loadScanBuffer(arch: Arch, buffer: ArrayBuffer, fileName: string, saved?: { labels?: Uint8Array; seeds?: { v: number; tooth: number }[]; paint?: Uint8Array }) {
    setState({ busy: `Reading ${fileName}…` });
    try {
      const geometry = parseScan(buffer, fileName);
      const model = new ArchModel(arch, geometry);
      if (!isIdentity(this.orientation)) model.applyMatrix(this.orientation);
      if (saved?.labels && saved.labels.length === model.vertexCount) model.labels.set(saved.labels);
      if (saved?.seeds) model.seeds = saved.seeds.filter((s) => s.v < model.vertexCount);
      if (saved?.paint && saved.paint.length === model.vertexCount) model.paint = saved.paint;
      model.gingivaRadiusMm = getState().settings.gingivaFlexMm;
      model.geometry.setAttribute('color', new BufferAttribute(new Float32Array(model.vertexCount * 3), 3));
      this.models[arch] = model;
      this.raw[arch] = { buffer, fileName };
      this.viewer?.setArchGeometry(arch, model.geometry, null);
      setState((s) => ({ arches: { ...s.arches, [arch]: { fileName, vertices: model.vertexCount, faces: model.faceCount } } }));
      this.afterSegmentation(true);
      this.setView('front');
    } catch (e) {
      toast(`Could not load ${fileName}: ${(e as Error).message}`, 'error');
    } finally {
      setState({ busy: null });
    }
  }

  removeArch(arch: Arch) {
    delete this.models[arch];
    delete this.raw[arch];
    this.viewer?.setArchGeometry(arch, null, null);
    setState((s) => ({ arches: { ...s.arches, [arch]: null } }));
    this.afterSegmentation(true);
  }

  loadDemo(segmented = true) {
    for (const arch of ARCHES) {
      const demo = makeDemoArch(arch);
      const stl = writeBinaryStl([{ positions: demo.geometry.getAttribute('position').array, index: demo.geometry.index!.array }]);
      this.loadScanBuffer(arch, stl.buffer as ArrayBuffer, `demo-${arch}.stl`);
      const model = this.models[arch]!;
      if (segmented) {
        const v = new Vector3();
        for (const t of demo.teeth) {
          let best = 0;
          let bd = Infinity;
          const target = new Vector3(t.x, t.y, t.top);
          for (let i = 0; i < model.vertexCount; i++) {
            const d = model.position(i, v).distanceToSquared(target);
            if (d < bd) (bd = d), (best = i);
          }
          model.addSeed(best, t.id);
        }
        this.resegment(arch);
      }
    }
    setState((s) => ({ oriented: true, missingTeeth: [18, 28, 38, 48], caseInfo: { ...s.caseInfo, patientName: s.caseInfo.patientName || 'Demo patient', caseId: s.caseInfo.caseId || 'DEMO-001' } }));
    this.afterSegmentation(true);
    this.setView('front');
  }

  // ───────────────────────────── segmentation ─────────────────────────────
  private segRadius = (tooth: number) => seedRadiusMm(tooth, getState().settings.seedReachScale);

  resegment(arch: Arch) {
    const m = this.models[arch];
    if (!m) return;
    // occlusal direction of this arch: patient up/down after orientation, otherwise estimated
    const up = getState().oriented ? new Vector3(0, 0, arch === 'lower' ? 1 : -1) : archOcclusalNormal(m, []);
    m.segment(this.segRadius, getState().settings.segTightness, { up, limitFor: crownHeightLimitMm });
  }

  resegmentAll() {
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (m) {
        this.pushSeg(arch);
        this.resegment(arch);
      }
    }
    this.afterSegmentation();
  }

  private pushSeg(arch: Arch) {
    const m = this.models[arch]!;
    this.undoStack.push({ kind: 'seg', arch, seeds: m.seeds.map((s) => ({ ...s })), paint: m.paint.slice(), labels: m.labels.slice() });
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
  }

  private handleClick(hit: Hit | null, ev: PointerEvent) {
    const s = getState();
    if (s.tool === 'measure') {
      if (!hit) return;
      if (!this.pendingMeasure) {
        this.pendingMeasure = hit.point.clone();
        this.viewer?.setMeasurements(s.measurements, this.pendingMeasure);
      } else {
        const a = this.pendingMeasure;
        const b = hit.point;
        this.pendingMeasure = null;
        const d = a.distanceTo(b);
        setState({
          measurements: [
            ...s.measurements,
            { id: Math.random().toString(36).slice(2), a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], label: `${d.toFixed(2)} mm` },
          ],
        });
        this.onMeasure?.(d);
      }
      return;
    }
    if (s.tool === 'orientPoints' && hit) {
      this.landmarks.push(hit.point.clone());
      setState({ orientPoints: this.landmarks.length });
      this.viewer?.setMeasurements([], hit.point);
      if (this.landmarks.length === 3) {
        const [inc, r, l] = this.landmarks;
        this.landmarks = [];
        const upHint = getState().oriented ? new Vector3(0, 0, 1) : this.estimateUp();
        this.applyOrientation(frameToMatrix(frameFromLandmarks(inc, r, l, upHint)));
        setState({ tool: 'orbit', orientPoints: 0 });
        this.viewer?.setMeasurements([], null);
        toast('Orientation set from landmarks.', 'success');
      }
      return;
    }
    if (s.tool === 'seed' && hit) {
      const m = this.models[hit.arch]!;
      const tooth = s.activeTooth;
      if (s.missingTeeth.includes(tooth)) {
        toast(`${tooth} is marked missing — unmark it in the chart first.`, 'error');
        return;
      }
      if (archOf(tooth) !== hit.arch) {
        toast(`Tooth ${tooth} belongs to the ${archOf(tooth)} arch — click on that arch or pick another tooth.`, 'error');
        return;
      }
      this.pushSeg(hit.arch);
      const v = m.nearestVertexOfFace(hit.face, hit.point);
      if (!ev.shiftKey) m.seeds = m.seeds.filter((x) => x.tooth !== tooth);
      // Clicking a crown that currently belongs to another tooth renumbers it.
      const prevLabel = m.labels[v];
      if (prevLabel && prevLabel !== tooth && !ev.shiftKey) {
        m.seeds = m.seeds.filter((x) => x.tooth !== prevLabel);
        toast(`This crown is now ${tooth} (was ${prevLabel}). Click the crown of ${prevLabel} if it is present.`, 'info');
      }
      m.addSeed(v, tooth);
      this.resegment(hit.arch);
      this.afterSegmentation();
      if (s.settings.autoAdvance && !ev.shiftKey) this.advanceActiveTooth();
      return;
    }
    if (hit) {
      const m = this.models[hit.arch]!;
      const v = m.nearestVertexOfFace(hit.face, hit.point);
      const label = m.labels[v];
      setState({ selectedTooth: label || null });
    } else if (s.tool === 'select' || s.tool === 'orbit') {
      setState({ selectedTooth: null });
    }
  }

  onMeasure: ((mm: number) => void) | null = null;

  private handlePaint(hit: Hit, phase: 'start' | 'move' | 'end') {
    const s = getState();
    if (phase === 'end') {
      if (this.strokeSnapshot) {
        for (const arch of ARCHES) if (this.models[arch]) this.resegment(arch);
        this.afterSegmentation();
      }
      this.strokeSnapshot = false;
      return;
    }
    const m = this.models[hit.arch];
    if (!m || hit.face < 0) return;
    if (phase === 'start') {
      this.pushSeg(hit.arch);
      this.strokeSnapshot = true;
    }
    const seed = m.nearestVertexOfFace(hit.face, hit.point);
    const verts = m.brushVertices(seed, hit.point, s.settings.brushRadiusMm);
    const value = s.tool === 'brushAdd' ? s.activeTooth : 0;
    if (value && archOf(value) !== hit.arch) return;
    m.paintVertices(verts, value);
    // live preview: write labels directly; the full watershed runs at the end of the stroke
    for (const v of verts) m.labels[v] = value;
    m.invalidate();
    this.updateColors();
  }

  advanceActiveTooth() {
    const s = getState();
    const arch = archOf(s.activeTooth);
    const seq = sequence(arch);
    const segmented = new Set(this.models[arch]?.teeth() ?? []);
    const i = seq.indexOf(s.activeTooth);
    for (let k = 1; k < seq.length; k++) {
      const next = seq[(i + k) % seq.length];
      if (!segmented.has(next) && !s.missingTeeth.includes(next)) {
        setState({ activeTooth: next });
        return;
      }
    }
  }

  clearTooth(id: number) {
    const arch = archOf(id);
    const m = this.models[arch];
    if (!m) return;
    this.pushSeg(arch);
    m.removeToothSeeds(id);
    this.resegment(arch);
    this.afterSegmentation();
  }

  clearAllSegmentation() {
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (!m) continue;
      this.pushSeg(arch);
      m.seeds = [];
      m.paint = new Uint8Array(m.vertexCount).fill(255);
      m.labels.fill(0);
      m.invalidate();
    }
    this.afterSegmentation();
  }

  /** Called whenever labels change: refresh caches, frames, plan entries, colors and ghosts. */
  afterSegmentation(immediate = false) {
    this.bodies.clear();
    this.trimDist = {};
    this.samples.clear();
    for (const arch of ARCHES) this.models[arch]?.invalidate();
    const teeth = ARCHES.flatMap((a) => this.models[a]?.teeth() ?? []).sort((a, b) => a - b);
    setState({ teeth });
    this.updateColors();
    this.rebuildGhosts();
    this.rebuildLayerIndices();
    this.clearAttachmentMeshes();
    if (immediate) this.recomputeFrames();
    else this.scheduleFrames();
  }

  private scheduleFrames() {
    if (this.framesQueued) return;
    this.framesQueued = true;
    queueMicrotask(() => {
      this.framesQueued = false;
      this.recomputeFrames();
    });
  }

  recomputeFrames() {
    const { protocol, plan } = getState();
    const frames: Record<number, ToothFrame> = {};
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (m) Object.assign(frames, computeArchFrames(m, protocol, plan.teeth));
    }
    const teeth: Record<number, ToothPlan> = {};
    for (const id of Object.keys(frames).map(Number)) {
      teeth[id] = plan.teeth[id] ?? { id, movement: zeroMovement(), startStage: 0, attachments: [] };
    }
    setState({ frames, plan: { ...plan, teeth } });
  }

  // ───────────────────────────── planning ─────────────────────────────
  private pushPlan() {
    this.undoStack.push({ kind: 'plan', plan: structuredClone(getState().plan) });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  setPlan(plan: TreatmentPlan, record = true) {
    if (record) this.pushPlan();
    setState({ plan });
  }

  updateTooth(id: number, patch: Partial<ToothPlan>, record = true) {
    const plan = getState().plan;
    const tp = plan.teeth[id];
    if (!tp) return;
    this.setPlan({ ...plan, teeth: { ...plan.teeth, [id]: { ...tp, ...patch } } }, record);
  }

  setMovement(id: number, patch: Partial<Movement>, record = true) {
    const tp = getState().plan.teeth[id];
    if (!tp) return;
    const proposed = { ...tp.movement };
    for (const [k, v] of Object.entries(patch)) proposed[k as keyof Movement] = Math.round((v as number) * 1000) / 1000;
    const { movement, notes } = constrainMovement(getState().protocol, tp, proposed);
    if (notes.length) toast(notes[0], 'info');
    this.updateTooth(id, { movement }, record);
  }

  /** Lock or unlock one degree of freedom of a tooth (a locked axis is held at 0). */
  toggleAxisLock(id: number, axis: keyof Movement) {
    const tp = getState().plan.teeth[id];
    if (!tp) return;
    const locked = new Set(tp.lockedAxes ?? []);
    if (locked.has(axis)) locked.delete(axis);
    else locked.add(axis);
    const lockedAxes = [...locked];
    const movement = { ...tp.movement };
    for (const k of lockedAxes) movement[k] = 0;
    this.updateTooth(id, { lockedAxes, movement });
  }

  /** Re-apply every tooth's constraints (e.g. after enabling hard protocol limits). */
  enforceConstraints(): number {
    const { plan, protocol } = getState();
    const next = structuredClone(plan);
    let changed = 0;
    for (const tp of Object.values(next.teeth)) {
      const r = constrainMovement(protocol, tp, tp.movement);
      if (r.notes.length) {
        tp.movement = r.movement;
        changed++;
      }
    }
    if (changed) this.setPlan(next);
    return changed;
  }

  resetTooth(id: number) {
    this.setMovement(id, zeroMovement());
  }

  resetAllMovements() {
    const plan = getState().plan;
    const teeth: Record<number, ToothPlan> = {};
    for (const [id, tp] of Object.entries(plan.teeth)) teeth[+id] = { ...tp, movement: zeroMovement(), startStage: 0 };
    this.setPlan({ ...plan, teeth, ipr: [] });
  }

  /** Copy a tooth's movement to its contralateral tooth (same clinical-frame values). */
  mirrorTooth(id: number, target: number) {
    const plan = getState().plan;
    if (!plan.teeth[id] || !plan.teeth[target]) return;
    this.setMovement(target, plan.teeth[id].movement);
  }

  addAttachment(id: number, att: Attachment) {
    const tp = getState().plan.teeth[id];
    if (!tp) return;
    this.updateTooth(id, { attachments: [...tp.attachments, att] });
  }

  updateAttachment(id: number, attId: string, patch: Partial<Attachment>) {
    const tp = getState().plan.teeth[id];
    if (!tp) return;
    this.updateTooth(id, { attachments: tp.attachments.map((a) => (a.id === attId ? { ...a, ...patch } : a)) });
  }

  removeAttachment(id: number, attId: string) {
    const tp = getState().plan.teeth[id];
    if (!tp) return;
    this.updateTooth(id, { attachments: tp.attachments.filter((a) => a.id !== attId) });
  }

  /** Add the attachments required by protocol rules that are not yet present. */
  autoAttachments(): number {
    const { plan, protocol } = getState();
    const next = structuredClone(plan);
    let added = 0;
    for (const tp of Object.values(next.teeth)) {
      for (const rule of triggeredAttachmentRules(protocol, tp.id, tp.movement)) {
        if (!tp.attachments.some((a) => a.type === rule.attachment)) {
          tp.attachments.push(newAttachment(rule.attachment, protocol.attachments.defaultStage, rule.id));
          added++;
        }
      }
    }
    if (added) this.setPlan(next);
    return added;
  }

  setIpr(contact: string, amountMm: number, stage?: number) {
    const plan = getState().plan;
    const others = plan.ipr.filter((e) => e.contact !== contact);
    const existing = plan.ipr.find((e) => e.contact === contact);
    const ipr = amountMm > 0 ? [...others, { contact, amountMm, stage: stage ?? existing?.stage ?? getState().protocol.ipr.defaultStage }] : others;
    this.setPlan({ ...plan, ipr });
  }

  applySuggestedIpr(): number {
    const { contacts, protocol, plan } = getState();
    if (!contacts) return 0;
    const sug = suggestIpr(protocol, contacts.filter((c) => c.stage > 0));
    if (!sug.length) return 0;
    const ipr = plan.ipr.filter((e) => !sug.some((s) => s.contact === e.contact));
    for (const s of sug) ipr.push({ contact: s.contact, amountMm: s.amountMm, stage: s.stage });
    this.setPlan({ ...plan, ipr });
    return sug.length;
  }

  /**
   * Layer presets. 'distalization': 7s → layer 1, 6s → 2, 5s → 3, 4s → 4, 3s → 5, incisors → 6 in the
   * chosen arch (classic sequential distalization). 'reset': every tooth back to layer 1.
   */
  applyLayerPreset(preset: 'distalization' | 'mesialization' | 'reset', arch: Arch) {
    const plan = getState().plan;
    const teeth: Record<number, ToothPlan> = {};
    for (const [k, tp] of Object.entries(plan.teeth)) {
      const id = +k;
      let layer = tp.layer ?? 1;
      if (archOf(id) === arch) {
        const n = toothNumber(id);
        if (preset === 'reset') layer = 1;
        else if (preset === 'distalization') layer = n >= 7 ? 1 : n === 6 ? 2 : n === 5 ? 3 : n === 4 ? 4 : n === 3 ? 5 : 6;
        else layer = n <= 2 ? 1 : n === 3 ? 2 : n === 4 ? 3 : n === 5 ? 4 : n === 6 ? 5 : 6;
      }
      teeth[id] = { ...tp, layer };
    }
    this.setPlan({ ...plan, teeth });
  }

  setProtocol(protocol: Protocol) {
    setState({ protocol });
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.redoStack.push(this.capture(snap));
    this.restore(snap);
  }

  redo() {
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(this.capture(snap));
    this.restore(snap);
  }

  private capture(like: Snapshot): Snapshot {
    if (like.kind === 'plan') return { kind: 'plan', plan: structuredClone(getState().plan) };
    const m = this.models[like.arch]!;
    return { kind: 'seg', arch: like.arch, seeds: m.seeds.map((s) => ({ ...s })), paint: m.paint.slice(), labels: m.labels.slice() };
  }

  private restore(snap: Snapshot) {
    if (snap.kind === 'plan') {
      setState({ plan: snap.plan });
      return;
    }
    const m = this.models[snap.arch];
    if (!m) return;
    m.seeds = snap.seeds;
    m.paint = snap.paint;
    m.labels.set(snap.labels);
    this.afterSegmentation();
  }

  // ───────────────────────────── staging ─────────────────────────────
  private scheduleRecompute() {
    if (this.recomputeQueued) return;
    this.recomputeQueued = true;
    queueMicrotask(() => {
      this.recomputeQueued = false;
      this.recompute();
    });
  }

  private sampleFor(id: number) {
    let s = this.samples.get(id);
    if (!s) {
      const m = this.models[archOf(id)];
      s = m ? crownSamples(m, id) : [];
      this.samples.set(id, s);
    }
    return s;
  }

  stagingInputs(): StagingToothInput[] {
    const { plan, frames } = getState();
    return Object.values(plan.teeth)
      .filter((tp) => frames[tp.id])
      .map((tp) => ({ plan: tp, frame: frames[tp.id], samples: this.sampleFor(tp.id) }));
  }

  recompute() {
    const { protocol, plan, contacts, stage, staging: prevStaging } = getState();
    const staging = computeStaging(protocol, this.stagingInputs());
    const issues = validatePlan(protocol, plan, staging, contacts ? contacts.filter((c) => c.stage > 0) : null);
    // keep showing the final position while the plan grows (e.g. while dragging the navigator)
    const wasFinal = prevStaging !== null && stage >= prevStaging.totalStages && stage > 0;
    setState({ staging, issues: [...issues, ...this.rootProximityIssues(staging.totalStages)], stage: wasFinal ? staging.totalStages : Math.min(stage, staging.totalStages) });
    this.applyStage();
  }

  /** Roots converging on each other (axis-to-axis clearance minus estimated root radii). */
  private rootProximityIssues(total: number): Issue[] {
    const { frames, plan } = getState();
    if (total === 0) return [];
    const T = this.transformsAt(total);
    const out: Issue[] = [];
    for (const arch of ARCHES) {
      const present = (this.models[arch]?.teeth() ?? []).filter((t) => frames[t]?.apex && !plan.teeth[t]?.extracted);
      for (const [a, b] of adjacentPairs(arch, present)) {
        const seg = (id: number, m: Matrix4 | undefined) => {
          const f = frames[id];
          const top = v3(f.cervical!).addScaledVector(v3(f.occlusal), -2);
          const ap = v3(f.apex!);
          return m ? [top.applyMatrix4(m), ap.applyMatrix4(m)] : [top, ap];
        };
        const r = 0.28 * ((frames[a].autoWidthMm || 6) + (frames[b].autoWidthMm || 6));
        const [a0, a1] = seg(a, undefined), [b0, b1] = seg(b, undefined);
        const before = segmentDistance(a0, a1, b0, b1) - r;
        const [c0, c1] = seg(a, T.get(a)), [d0, d1] = seg(b, T.get(b));
        const after = segmentDistance(c0, c1, d0, d1) - r;
        if (after < 0.3 && after < before - 0.2) {
          out.push({ severity: 'warning', rule: 'ROOT-PROXIMITY', contact: contactKey(a, b), tooth: a, message: `Roots of ${a} and ${b} converge (estimated clearance ${after.toFixed(1)} mm at the end, ${before.toFixed(1)} mm initially). Check tip/torque.` });
        }
      }
    }
    return out;
  }

  transformsAt(stage: number, arch?: Arch): Map<number, Matrix4> {
    const { plan, frames, staging } = getState();
    const out = new Map<number, Matrix4>();
    for (const tp of Object.values(plan.teeth)) {
      if (arch && archOf(tp.id) !== arch) continue;
      const f = frames[tp.id];
      if (!f) continue;
      const m = movementAtStage(tp, staging?.teeth[tp.id], stage);
      if (isZeroMovement(m)) continue;
      out.set(tp.id, movementMatrix(f, m));
    }
    return out;
  }

  /** Extracted teeth collapse to a gum patch from the first aligner on. */
  flattenAt(stage: number, arch?: Arch): Map<number, { point: Vector3; normal: Vector3 }> {
    const { plan, frames } = getState();
    const out = new Map<number, { point: Vector3; normal: Vector3 }>();
    if (stage < 1) return out;
    for (const tp of Object.values(plan.teeth)) {
      if (!tp.extracted || (arch && archOf(tp.id) !== arch)) continue;
      const f = frames[tp.id];
      if (!f?.cervical) continue;
      const n = v3(f.occlusal);
      out.set(tp.id, { point: v3(f.cervical).addScaledVector(n, -0.3), normal: n });
    }
    return out;
  }

  /** Vertex positions of an arch at a stage (moved teeth, blended gum, extractions). */
  positionsAt(arch: Arch, stage: number): Float32Array {
    return this.models[arch]!.deformedPositions(this.transformsAt(stage, arch), undefined, this.flattenAt(stage, arch));
  }

  applyStage(stageOverride?: number) {
    const v = this.viewer;
    const stage = stageOverride ?? getState().stage;
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (!m) continue;
      m.deform(this.transformsAt(stage, arch), this.flattenAt(stage, arch));
      v?.markGeometryChanged(arch);
    }
    this.updatePontics(stage);
    this.updateAttachmentMeshes(stage);
    this.updateRootMeshes(stage);
    this.updateAxes(stage);
    v?.requestRender();
  }

  setStage(n: number) {
    const total = getState().staging?.totalStages ?? 0;
    setState({ stage: Math.max(0, Math.min(total, Math.round(n))) });
  }

  private updatePlayback() {
    if (this.playTimer !== null) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    if (!getState().playing) return;
    this.playTimer = window.setInterval(() => {
      const { stage, staging } = getState();
      const total = staging?.totalStages ?? 0;
      if (total === 0) return setState({ playing: false });
      setState({ stage: stage >= total ? 0 : stage + 1 });
    }, 350);
  }

  // ───────────────────────────── contacts ─────────────────────────────
  body(id: number): ToothBody | null {
    let b = this.bodies.get(id);
    if (!b) {
      const m = this.models[archOf(id)];
      if (!m || !m.teeth().includes(id)) return null;
      b = new ToothBody(m, id);
      this.bodies.set(id, b);
    }
    return b;
  }

  async analyzeContacts(allStages: boolean) {
    const { staging, plan } = getState();
    const total = staging?.totalStages ?? 0;
    const stages = allStages ? Array.from({ length: total + 1 }, (_, i) => i) : [0, total];
    const pairs: [number, number][] = [];
    for (const arch of ARCHES) {
      const present = (this.models[arch]?.teeth() ?? []).filter((t) => !plan.teeth[t]?.extracted);
      pairs.push(...adjacentPairs(arch, present));
    }
    const results: ContactReport[] = [];
    const samples = new Map<string, [Float32Array, Float32Array]>();
    let done = 0;
    const totalWork = stages.length * pairs.length;
    for (const st of [...new Set(stages)]) {
      const T = this.transformsAt(st);
      for (const [a, b] of pairs) {
        const ba = this.body(a), bb = this.body(b);
        if (!ba || !bb) continue;
        const key = contactKey(a, b);
        const fa = getState().frames[a];
        const occlusal = fa ? v3(fa.occlusal) : new Vector3(0, 0, 1);
        if (!samples.has(key)) samples.set(key, [ba.facingSamples(bb.centroid, occlusal), bb.facingSamples(ba.centroid, occlusal)]);
        const [sa, sb] = samples.get(key)!;
        const d = contactDistance(ba, T.get(a) ?? new Matrix4(), bb, T.get(b) ?? new Matrix4(), sa, sb, occlusal);
        results.push({ contact: key, a, b, stage: st, distanceMm: d });
        done++;
      }
      setState({ busy: `Measuring contacts… ${Math.round((done / Math.max(1, totalWork)) * 100)}%` });
      await new Promise((r) => setTimeout(r, 0));
    }
    // keep initial values and the worst (most overlapping) stage per contact
    const worst = new Map<string, ContactReport>();
    for (const r of results) {
      if (r.stage === 0) continue;
      const w = worst.get(r.contact);
      if (!w || r.distanceMm < w.distanceMm) worst.set(r.contact, r);
    }
    const initial = results.filter((r) => r.stage === 0);
    setState({ contacts: [...initial, ...worst.values()], contactsStale: false, busy: null });
    this.recompute();
  }

  // ───────────────────────────── attachments ─────────────────────────────
  private clearAttachmentMeshes() {
    for (const mesh of this.attachmentMeshes.values()) {
      mesh.geometry.dispose();
      this.viewer?.attachmentGroup.remove(mesh);
    }
    this.attachmentMeshes.clear();
  }

  attachmentGeometryFor(id: number, att: Attachment): BufferGeometry | null {
    const frame = getState().frames[id];
    const body = this.body(id);
    if (!frame || !body) return null;
    return attachmentGeometry(att, frame, body);
  }

  private updateAttachmentMeshes(stageOverride?: number) {
    const v = this.viewer;
    const { plan, settings } = getState();
    const stage = stageOverride ?? getState().stage;
    const wanted = new Set<string>();
    for (const tp of Object.values(plan.teeth)) {
      for (const att of tp.attachments) {
        const key = `${tp.id}|${att.id}|${att.type}|${att.size.join(',')}|${att.offsetMesialMm}|${att.offsetOcclusalMm}`;
        wanted.add(key);
        let mesh = this.attachmentMeshes.get(key);
        if (!mesh) {
          const g = this.attachmentGeometryFor(tp.id, att);
          if (!g) continue;
          mesh = new Mesh(g, this.attachmentMaterial);
          mesh.matrixAutoUpdate = false;
          mesh.userData = { tooth: tp.id, stageFrom: att.stageFrom };
          this.attachmentMeshes.set(key, mesh);
          v?.attachmentGroup.add(mesh);
        }
        mesh.userData.stageFrom = att.stageFrom;
      }
    }
    for (const [key, mesh] of this.attachmentMeshes) {
      if (!wanted.has(key)) {
        v?.attachmentGroup.remove(mesh);
        mesh.geometry.dispose();
        this.attachmentMeshes.delete(key);
      }
    }
    const T = this.transformsAt(stage);
    for (const mesh of this.attachmentMeshes.values()) {
      const id = mesh.userData.tooth as number;
      mesh.matrix.copy(T.get(id) ?? new Matrix4());
      mesh.matrixWorldNeedsUpdate = true;
      const archVisible = archOf(id) === 'upper' ? settings.showUpper : settings.showLower;
      mesh.visible = settings.showAttachments && archVisible && stage >= (mesh.userData.stageFrom as number);
    }
    v?.requestRender();
  }

  // ───────────────────────────── display ─────────────────────────────
  updateColors() {
    const { step, selectedTooth, plan, activeTooth, layers } = getState();
    const segmenting = step === 'segment' || step === 'import';
    const gumColor: Record<Arch, Color> = { upper: new Color(layers.upperGum.color), lower: new Color(layers.lowerGum.color) };
    const toothColor: Record<Arch, Color> = { upper: new Color(layers.upperTeeth.color), lower: new Color(layers.lowerTeeth.color) };
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (!m) continue;
      const attr = m.geometry.getAttribute('color') as BufferAttribute;
      const c = attr.array as Float32Array;
      const anyTeeth = m.labels.some((l) => l > 0);
      const cache = new Map<number, Color>();
      for (let i = 0; i < m.vertexCount; i++) {
        const l = m.labels[i];
        let col: Color;
        if (!l) col = anyTeeth ? gumColor[arch] : COLORS.scan;
        else {
          col = cache.get(l)!;
          if (!col) {
            if (segmenting) col = l === activeTooth ? COLORS.selected : toothHue(l);
            else if (plan.teeth[l]?.extracted) col = gumColor[arch];
            else if (l === selectedTooth) col = COLORS.selected;
            else if (plan.teeth[l]?.locked) col = COLORS.locked;
            else col = toothColor[arch];
            cache.set(l, col);
          }
        }
        c[3 * i] = col.r;
        c[3 * i + 1] = col.g;
        c[3 * i + 2] = col.b;
      }
      attr.needsUpdate = true;
    }
    this.viewer?.requestRender();
  }

  private applyLayers() {
    const { layers, settings } = getState();
    this.viewer?.applyLayers(layers, { upper: settings.showUpper, lower: settings.showLower });
  }

  /** Gum layer = faces touching gingiva; teeth layer = faces whose three vertices are teeth. */
  private rebuildLayerIndices() {
    const v = this.viewer;
    if (!v) return;
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (!m) continue;
      const gum: number[] = [];
      const teeth: number[] = [];
      const seam: number[] = [];
      const L = m.labels;
      const ext = new Set(Object.values(getState().plan.teeth).filter((t) => t.extracted).map((t) => t.id));
      for (let f = 0; f < m.faceCount; f++) {
        const a = m.index[3 * f], b = m.index[3 * f + 1], c = m.index[3 * f + 2];
        if (!(L[a] && L[b] && L[c]) || ext.has(L[a]) || ext.has(L[b]) || ext.has(L[c])) gum.push(a, b, c);
        else if (L[a] === L[b] && L[b] === L[c]) teeth.push(a, b, c);
        else seam.push(a, b, c);
      }
      v.setLayerIndex(arch, new Uint32Array(gum), new Uint32Array(teeth), new Uint32Array(seam));
    }
    this.applyLayers();
  }

  private bases: Partial<Record<Arch, ModelBase | null>> = {};

  /** Occlusal direction used for the model base: mean of the arch's tooth frames, else scan PCA. */
  private archOcclusal(arch: Arch): Vector3 {
    const { frames } = getState();
    const o = new Vector3();
    for (const f of Object.values(frames)) if (archOf(f.id) === arch) o.add(v3(f.occlusal));
    if (o.lengthSq() > 0) return o.normalize();
    return archOcclusalNormal(this.models[arch]!, []);
  }

  /** Text engraved into the base of a stage model, e.g. "SC-0142 U07". */
  labelText(arch: Arch, stage: number): string {
    const id = getState().caseInfo.caseId.trim() || getState().caseInfo.patientName.trim() || 'CASE';
    return `${id.slice(0, 14)} ${arch === 'upper' ? 'U' : 'L'}${String(stage).padStart(2, '0')}`;
  }

  /**
   * Model base (printable solid closure) for an arch, or null when the model builder is off. With a
   * stage, the base carries that stage's engraved label (built fresh); without, the cached base.
   */
  baseFor(arch: Arch, stage?: number): ModelBase | null {
    const mb = getState().modelBuilder;
    if (!mb.enabled || !this.models[arch]) return null;
    const anterior = getState().oriented ? new Vector3(0, 1, 0) : this.patientAxes().anterior;
    if (mb.label && stage !== undefined) {
      return buildModelBase(this.models[arch]!, this.archOcclusal(arch), { thicknessMm: mb.thicknessMm, label: this.labelText(arch, stage), labelUp: anterior });
    }
    if (this.bases[arch] === undefined) {
      this.bases[arch] = buildModelBase(this.models[arch]!, this.archOcclusal(arch), {
        thicknessMm: mb.thicknessMm,
        label: mb.label ? this.labelText(arch, getState().stage) : undefined,
        labelUp: anterior,
      });
    }
    return this.bases[arch] ?? null;
  }

  // ───────────────────────────── trim lines ─────────────────────────────
  private trimDist: Partial<Record<Arch, Float32Array>> = {};

  /** Aligner trim line of an arch at a stage (patient coordinates), or [] if not segmented. */
  trimLineAt(arch: Arch, stage: number): Vector3[] {
    const m = this.models[arch];
    if (!m || !m.labels.some((l) => l > 0)) return [];
    if (!this.trimDist[arch]) this.trimDist[arch] = gumDistanceToTeeth(m);
    return trimLine(m, this.trimDist[arch]!, this.positionsAt(arch, stage), getState().modelBuilder.trimOffsetMm);
  }

  updateTrimLines() {
    const { modelBuilder, step, stage, settings } = getState();
    if (!this.viewer) return;
    if (!modelBuilder.trimLines || step !== 'export') return this.viewer.setTrimLines([]);
    const lines = ARCHES.filter((a) => (a === 'upper' ? settings.showUpper : settings.showLower)).map((a) => this.trimLineAt(a, stage)).filter((l) => l.length > 1);
    this.viewer.setTrimLines(lines);
  }

  rebuildBases() {
    this.bases = {};
    const report: Partial<Record<Arch, { openEdges: number; holesFilled: number; borderVertices: number; labelPlaced?: boolean }>> = {};
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (!m) continue;
      const base = this.baseFor(arch);
      if (!base) {
        this.viewer?.setBaseGeometry(arch, null);
        continue;
      }
      const N = m.vertexCount;
      const all = new Uint32Array(m.index.length + base.index.length);
      all.set(m.index);
      all.set(base.index, m.index.length);
      report[arch] = { openEdges: openEdgeCount(all, N + base.positions.length / 3), holesFilled: base.holesFilled, borderVertices: base.borderLength, labelPlaced: base.labelPlaced };
      // compact preview geometry of just the base triangles
      const remap = new Map<number, number>();
      const pos: number[] = [];
      const idx: number[] = [];
      for (const vi of base.index) {
        let k = remap.get(vi);
        if (k === undefined) {
          k = remap.size;
          remap.set(vi, k);
          if (vi < N) pos.push(m.base[3 * vi], m.base[3 * vi + 1], m.base[3 * vi + 2]);
          else pos.push(base.positions[3 * (vi - N)], base.positions[3 * (vi - N) + 1], base.positions[3 * (vi - N) + 2]);
        }
        idx.push(k);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.viewer?.setBaseGeometry(arch, g);
    }
    setState({ baseReport: report });
    this.applyLayers();
  }

  private rebuildGhosts() {
    const v = this.viewer;
    if (!v) return;
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (!m) {
        v.setGhostGeometry(arch, null);
        continue;
      }
      const index: number[] = [];
      for (let f = 0; f < m.faceCount; f++) {
        const a = m.index[3 * f], b = m.index[3 * f + 1], c = m.index[3 * f + 2];
        if (m.labels[a] && m.labels[b] && m.labels[c]) index.push(a, b, c);
      }
      if (!index.length) {
        v.setGhostGeometry(arch, null);
        continue;
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(m.base, 3));
      g.setIndex(index);
      v.setGhostGeometry(arch, g);
    }
    this.applySettings(false);
  }

  private applySettings(flexChanged: boolean) {
    const v = this.viewer;
    const { settings, stage } = getState();
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (m && flexChanged) {
        m.gingivaRadiusMm = settings.gingivaFlexMm;
        m.invalidate();
      }
      if (!v) continue;
      const show = arch === 'upper' ? settings.showUpper : settings.showLower;
      v.setVisible(v.archMeshes[arch], show);
      v.setVisible(v.ghostMeshes[arch], show && settings.showGhost && stage > 0);
    }
    if (v) v.brushRadius = settings.brushRadiusMm;
    this.applyLayers();
    if (flexChanged) this.applyStage();
    else {
      this.updateAttachmentMeshes();
      this.updateAxes();
    }
  }

  private applyTool() {
    const v = this.viewer;
    if (!v) return;
    const { tool } = getState();
    v.setPaintMode(tool === 'brushAdd' || tool === 'brushErase');
    v.setBrushColor(tool === 'brushErase' ? 0xef4444 : 0x22c55e);
    if (tool !== 'measure' && this.pendingMeasure) {
      this.pendingMeasure = null;
      v.setMeasurements(getState().measurements, null);
    }
    v.renderer.domElement.style.cursor = tool === 'seed' || tool === 'measure' ? 'crosshair' : 'default';
  }

  private updateAxes(stageOverride?: number) {
    const v = this.viewer;
    if (!v) return;
    const { selectedTooth, frames, settings, step, plan } = getState();
    const stage = stageOverride ?? getState().stage;
    const T = this.transformsAt(stage);
    // live preview while dragging an axis ring: rotate the selected tooth's axes
    const preview = this.axisDrag ? new Matrix4().makeRotationAxis(this.axisDrag.axis, this.axisDrag.delta) : null;
    const dir = (d: [number, number, number], m: Matrix4, id?: number) => {
      const out = v3(d).transformDirection(m);
      return preview && id === this.axisDrag?.id ? out.transformDirection(preview) : out;
    };
    // Plan step: the 3D navigator on the selected tooth
    const tp = selectedTooth !== null ? plan.teeth[selectedTooth] : undefined;
    if (step === 'plan' && tp && frames[tp.id] && !tp.locked && !tp.extracted) {
      const f = frames[tp.id];
      const m = T.get(tp.id) ?? new Matrix4();
      v.setGizmo({ origin: v3(f.centroid).applyMatrix4(m), mesial: v3(f.mesial), buccal: v3(f.buccal), occlusal: v3(f.occlusal) });
    } else if (step === 'axes' && selectedTooth !== null && frames[selectedTooth]) {
      const f = frames[selectedTooth];
      v.setGizmo({ mode: 'axes', origin: v3(f.centroid), mesial: dir(f.mesial, new Matrix4(), f.id), buccal: dir(f.buccal, new Matrix4(), f.id), occlusal: dir(f.occlusal, new Matrix4(), f.id) });
    } else v.setGizmo(null);
    // Axes step: every tooth's frame (selected tooth larger); other steps: none
    if (step === 'axes' || (settings.showAxes && step !== 'plan' && step !== 'segment' && step !== 'import' && step !== 'orient' && selectedTooth !== null)) {
      const ids = step === 'axes' ? Object.keys(frames).map(Number) : selectedTooth !== null && frames[selectedTooth] ? [selectedTooth] : [];
      v.setAxes(
        ids.map((id) => {
          const f = frames[id];
          const m = T.get(id) ?? new Matrix4();
          const big = id === selectedTooth;
          return {
            origin: v3(f.centroid).applyMatrix4(m),
            length: big ? 8 : 4.5,
            dirs: [[dir(f.mesial, m, id), 0xef4444], [dir(f.buccal, m, id), 0x22c55e], [dir(f.occlusal, m, id), 0x3b82f6]] as [Vector3, number][],
          };
        }),
      );
    } else v.setAxes([]);
  }

  /** Tooth-number labels on the crowns (segmentation and axes steps). */
  private updateLabels() {
    const v = this.viewer;
    if (!v) return;
    const { step, frames, settings } = getState();
    if (step !== 'segment' && step !== 'axes') return v.setToothLabels([]);
    const labels: { text: string; pos: Vector3 }[] = [];
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (!m || !(arch === 'upper' ? settings.showUpper : settings.showLower)) continue;
      const seen = new Set<number>();
      for (const sd of m.seeds) {
        if (seen.has(sd.tooth)) continue;
        seen.add(sd.tooth);
        const f = frames[sd.tooth];
        const pos = f ? v3(f.centroid) : m.position(sd.v);
        labels.push({ text: String(sd.tooth), pos });
      }
    }
    v.setToothLabels(labels);
  }

  patientAxes(): PatientAxes {
    const { frames } = getState();
    const v = this.viewer;
    const box = v ? v.bounds() : null;
    const center = new Vector3();
    let size = 80;
    if (box && !box.isEmpty()) {
      box.getCenter(center);
      size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    }
    let up = new Vector3(0, 0, 1);
    let anterior = new Vector3(0, 1, 0);
    if (getState().oriented) return { center, up, anterior, right: new Vector3(1, 0, 0), size };
    const ids = Object.keys(frames).map(Number);
    const upperIds = ids.filter((i) => i < 30);
    const lowerIds = ids.filter((i) => i > 30);
    if (ids.length >= 3) {
      const u = new Vector3();
      upperIds.forEach((i) => u.sub(v3(frames[i].occlusal)));
      lowerIds.forEach((i) => u.add(v3(frames[i].occlusal)));
      if (u.lengthSq() > 0) up = u.normalize();
      const inc = ids.filter((i) => toothNumber(i) <= 2);
      const a = new Vector3();
      (inc.length ? inc : ids).forEach((i) => a.add(v3(frames[i].buccal)));
      a.addScaledVector(up, -a.dot(up));
      if (a.lengthSq() > 0) anterior = a.normalize();
    }
    const right = new Vector3().crossVectors(anterior, up).normalize();
    return { center, up, anterior, right, size };
  }

  setView(view: View) {
    // Occlusal views show one arch; buccal views show both in occlusion.
    const { settings } = getState();
    const vis = view === 'upperOcclusal' ? { showUpper: true, showLower: false } : view === 'lowerOcclusal' ? { showUpper: false, showLower: true } : { showUpper: true, showLower: true };
    if (vis.showUpper !== settings.showUpper || vis.showLower !== settings.showLower) setState({ settings: { ...settings, ...vis } });
    this.viewer?.setView(view, this.patientAxes());
  }

  // ───────────────────────────── orientation ─────────────────────────────
  private estimateUp(): Vector3 {
    const arches = ARCHES.filter((a) => this.models[a]).map((arch) => ({ arch, model: this.models[arch]! }));
    return arches.length ? estimatePatientFrame(arches).up : new Vector3(0, 0, 1);
  }

  /** Rigidly re-orient all scans together (bite preserved). */
  applyOrientation(delta: Matrix4) {
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (!m) continue;
      m.applyMatrix(delta);
      this.viewer?.markGeometryChanged(arch);
    }
    this.orientation.premultiply(delta);
    setState({ oriented: true, measurements: [] });
    this.afterSegmentation(true);
    this.rebuildBases();
    this.applyStage();
    this.setView('front');
  }

  autoOrient() {
    const arches = ARCHES.filter((a) => this.models[a]).map((arch) => ({ arch, model: this.models[arch]! }));
    if (!arches.length) return;
    this.applyOrientation(frameToMatrix(estimatePatientFrame(arches)));
    toast('Scans oriented automatically: check the front, side and occlusal views.', 'success');
  }

  /** Fine rotation about a patient axis through the scan centre. */
  nudgeOrientation(axis: 'x' | 'y' | 'z', degrees: number) {
    const box = this.viewer?.bounds();
    const c = box && !box.isEmpty() ? box.getCenter(new Vector3()) : new Vector3();
    const R = new Matrix4().makeRotationAxis(new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), (degrees * Math.PI) / 180);
    const delta = new Matrix4().makeTranslation(c.x, c.y, c.z).multiply(R).multiply(new Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    const view = this.viewer ? { pos: this.viewer.camera.position.clone(), up: this.viewer.camera.up.clone(), target: this.viewer.controls.target.clone() } : null;
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (m) (m.applyMatrix(delta), this.viewer?.markGeometryChanged(arch));
    }
    this.orientation.premultiply(delta);
    setState({ oriented: true });
    this.afterSegmentation(true);
    this.rebuildBases();
    this.applyStage();
    if (view && this.viewer) {
      // keep the camera still so the rotation is visible against the guides
      this.viewer.camera.position.copy(view.pos);
      this.viewer.camera.up.copy(view.up);
      this.viewer.controls.target.copy(view.target);
      this.viewer.controls.update();
    }
  }

  resetOrientation() {
    this.applyOrientation(this.orientation.clone().invert());
    setState({ oriented: false });
  }

  startLandmarks() {
    this.landmarks = [];
    setState({ tool: 'orientPoints', orientPoints: 0 });
  }

  // ───────────────────────────── model preparation ─────────────────────────────
  /**
   * Replace an arch's mesh (patient coordinates) after repair/trim. The saved scan is stored back in
   * scanner coordinates so reopening the project re-applies the orientation correctly.
   * Segmentation of that arch is reset (topology changed).
   */
  private replaceArchMesh(arch: Arch, mesh: RawMesh) {
    const old = this.raw[arch];
    const geometry = toGeometry(mesh);
    const toScanner = this.orientation.clone().invert();
    const scannerPos = new Float32Array(mesh.position.length);
    const v = new Vector3();
    for (let i = 0; i < mesh.position.length / 3; i++) {
      v.fromArray(mesh.position, 3 * i).applyMatrix4(toScanner);
      scannerPos.set([v.x, v.y, v.z], 3 * i);
    }
    const stl = writeBinaryStl([{ positions: scannerPos, index: mesh.index }]);
    const baseName = (old?.fileName ?? `${arch}.stl`).replace(/(-prepared)?\.[^.]+$/, '');
    this.raw[arch] = { buffer: stl.buffer as ArrayBuffer, fileName: `${baseName}-prepared.stl` };
    const model = new ArchModel(arch, geometry);
    model.gingivaRadiusMm = getState().settings.gingivaFlexMm;
    model.geometry.setAttribute('color', new BufferAttribute(new Float32Array(model.vertexCount * 3), 3));
    this.models[arch] = model;
    this.viewer?.setArchGeometry(arch, model.geometry, null);
    setState((s) => ({ arches: { ...s.arches, [arch]: { fileName: this.raw[arch]!.fileName, vertices: model.vertexCount, faces: model.faceCount } } }));
    this.undoStack = this.undoStack.filter((u) => u.kind !== 'seg' || u.arch !== arch);
    this.afterSegmentation(true);
    this.rebuildBases();
    this.applyStage();
  }

  /** Remove floating debris and fill small scan holes on every arch. */
  repairScans(): { removed: number; filled: number } {
    let removed = 0, filled = 0;
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (!m) continue;
      const a = removeSmallComponents({ position: new Float32Array(m.base), index: m.index });
      const b = fillSmallHoles(a.mesh);
      removed += a.removed;
      filled += b.filled;
      if (a.removed || b.filled) this.replaceArchMesh(arch, b.mesh);
    }
    return { removed, filled };
  }

  /** Crown-top level of an arch in patient coordinates (lower: highest z, upper: lowest z). */
  archTipLevel(arch: Arch): number | null {
    const m = this.models[arch];
    if (!m) return null;
    let lvl = arch === 'lower' ? -Infinity : Infinity;
    for (let i = 0; i < m.vertexCount; i++) {
      const z = m.base[3 * i + 2];
      lvl = arch === 'lower' ? Math.max(lvl, z) : Math.min(lvl, z);
    }
    return lvl;
  }

  /** Plane height that keeps `keepMm` of model measured from the crown tops. */
  trimLevel(arch: Arch, keepMm: number): number | null {
    const tip = this.archTipLevel(arch);
    return tip === null ? null : arch === 'lower' ? tip - keepMm : tip + keepMm;
  }

  previewTrim(arch: Arch, keepMm: number | null) {
    const z = keepMm === null ? null : this.trimLevel(arch, keepMm);
    this.viewer?.setTrimPreview(arch, z);
  }

  /** Cut the scan with a plane parallel to the occlusal plane, `keepMm` from the crown tops. */
  trimArch(arch: Arch, keepMm: number) {
    const m = this.models[arch];
    const z = this.trimLevel(arch, keepMm);
    if (!m || z === null) return;
    const normal = new Vector3(0, 0, arch === 'lower' ? 1 : -1);
    const mesh = trimByPlane({ position: new Float32Array(m.base), index: m.index }, new Vector3(0, 0, z), normal);
    this.viewer?.setTrimPreview(arch, null);
    this.replaceArchMesh(arch, mesh);
  }

  // ───────────────────────────── auto segmentation & axes ─────────────────────────────
  toggleMissing(id: number) {
    const { missingTeeth } = getState();
    const missing = missingTeeth.includes(id) ? missingTeeth.filter((t) => t !== id) : [...missingTeeth, id];
    setState({ missingTeeth: missing });
    if (missing.includes(id) && this.models[archOf(id)]?.teeth().includes(id)) this.clearTooth(id);
  }

  autoSegment() {
    if (!getState().oriented) this.autoOrient();
    const { missingTeeth } = getState();
    let n = 0;
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (!m) continue;
      this.pushSeg(arch);
      const present = sequence(arch).filter((t) => !missingTeeth.includes(t));
      const auto = autoSegmentSeeds(m, arch, present);
      m.seeds = auto.teeth;
      m.paint = new Uint8Array(m.vertexCount).fill(255);
      for (const v of auto.gum) m.paint[v] = 0;
      this.resegment(arch);
      n += new Set(m.seeds.map((x) => x.tooth)).size;
    }
    this.afterSegmentation();
    toast(`${n} teeth found. Check the numbers on the crowns; click a crown to fix its number, brush to fix edges.`, 'success');
  }

  setAxisCorrection(id: number, corr: AxisCorrection) {
    this.updateTooth(id, { axisCorrection: corr });
    this.recomputeFrames();
  }

  setRootLength(id: number, mm: number | undefined) {
    this.updateTooth(id, { rootLengthMm: mm });
    this.recomputeFrames();
  }

  // ───────────────────────────── navigator ─────────────────────────────
  private handleGizmo(h: GizmoHandle, delta: number, phase: 'start' | 'move' | 'end') {
    const { selectedTooth, plan, staging, step } = getState();
    if (selectedTooth === null) return;
    if (step === 'axes') {
      if (h.kind !== 'rotate' || (h.key !== 'tip' && h.key !== 'torque' && h.key !== 'rotation')) return;
      if (phase === 'start') {
        this.axisDrag = { id: selectedTooth, key: h.key, start: plan.teeth[selectedTooth]?.axisCorrection ?? { tip: 0, torque: 0, rotation: 0 }, axis: h.axis.clone(), delta: 0 };
      } else if (phase === 'move' && this.axisDrag) {
        const deg = Math.round(((delta * 180) / Math.PI) / 0.5) * 0.5;
        this.axisDrag.delta = (deg * Math.PI) / 180;
        this.updateAxes();
      } else if (phase === 'end' && this.axisDrag) {
        const d = this.axisDrag;
        this.axisDrag = null;
        const deg = Math.round(((d.delta * 180) / Math.PI) / 0.5) * 0.5;
        if (deg !== 0) this.setAxisCorrection(d.id, { ...d.start, [d.key]: d.start[d.key] + deg });
        else this.updateAxes();
      }
      return;
    }
    const tp = plan.teeth[selectedTooth];
    if (!tp) return;
    if (phase === 'start') {
      this.pushPlan();
      this.gizmoStart = { id: selectedTooth, key: h.key, value: tp.movement[h.key] };
      if (staging) setState({ stage: Math.max(1, staging.totalStages) });
      return;
    }
    if (phase === 'end' || !this.gizmoStart) {
      this.gizmoStart = null;
      return;
    }
    const inc = h.kind === 'translate' ? 0.05 : 0.5;
    const raw = h.kind === 'translate' ? delta : (delta * 180) / Math.PI;
    const value = this.gizmoStart.value + Math.round(raw / inc) * inc;
    if (Math.abs(value - tp.movement[h.key]) > 1e-9) this.setMovement(selectedTooth, { [h.key]: value }, false);
  }

  /** Overjet / overbite / midline at a stage (needs both arches, oriented, centrals segmented). */
  occlusionAt(stage: number): OcclusionMetrics | null {
    const u = this.models.upper, l = this.models.lower;
    if (!u || !l || !getState().oriented) return null;
    return occlusionMetrics(u, this.positionsAt('upper', stage), l, this.positionsAt('lower', stage));
  }

  // ───────────────────────────── pontics ─────────────────────────────
  private ponticMeshes = new Map<number, Mesh>();
  private ponticMaterial = new MeshStandardMaterial({ color: 0xf2ead6, roughness: 0.5 });

  /** Midsagittal x of an arch (between the central incisors, else 0 in patient coordinates). */
  private midlineX(arch: Arch): number {
    const { frames } = getState();
    const pair = arch === 'upper' ? [11, 21] : [41, 31];
    if (frames[pair[0]] && frames[pair[1]]) return (frames[pair[0]].centroid[0] + frames[pair[1]].centroid[0]) / 2;
    return 0;
  }

  /** Mirrored crown of the source tooth, in initial (stage 0) coordinates plus the pontic offset. */
  ponticGeometry(p: { id: number; source: number; offset: [number, number, number] }): BufferGeometry | null {
    const body = this.body(p.source);
    if (!body) return null;
    const g = body.geometry.clone();
    const mx = this.midlineX(archOf(p.id));
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setX(i, 2 * mx - pos.getX(i) + p.offset[0]), pos.setY(i, pos.getY(i) + p.offset[1]), pos.setZ(i, pos.getZ(i) + p.offset[2]);
    const idx = g.index!;
    for (let f = 0; f < idx.count; f += 3) {
      const b = idx.getX(f + 1);
      idx.setX(f + 1, idx.getX(f + 2));
      idx.setX(f + 2, b);
    }
    g.computeVertexNormals();
    return g;
  }

  /** Translation of a pontic at a stage: average displacement of its present neighbours. */
  ponticShift(id: number, stage: number): Vector3 {
    const { frames, plan } = getState();
    const arch = archOf(id);
    const present = (this.models[arch]?.teeth() ?? []).filter((t) => !plan.teeth[t]?.extracted);
    const seq = sequence(arch);
    const i = seq.indexOf(id);
    const neighbours: number[] = [];
    for (let k = i - 1; k >= 0; k--) if (present.includes(seq[k])) { neighbours.push(seq[k]); break; }
    for (let k = i + 1; k < seq.length; k++) if (present.includes(seq[k])) { neighbours.push(seq[k]); break; }
    const T = this.transformsAt(stage, arch);
    const shift = new Vector3();
    for (const n of neighbours) {
      const c = v3(frames[n].centroid);
      shift.add(c.clone().applyMatrix4(T.get(n) ?? new Matrix4()).sub(c));
    }
    return neighbours.length ? shift.multiplyScalar(1 / neighbours.length) : shift;
  }

  rebuildPontics() {
    for (const m of this.ponticMeshes.values()) {
      this.viewer?.scene.remove(m);
      m.geometry.dispose();
    }
    this.ponticMeshes.clear();
    for (const p of getState().plan.pontics ?? []) {
      const g = this.ponticGeometry(p);
      if (!g) continue;
      const mesh = new Mesh(g, this.ponticMaterial);
      mesh.userData = { id: p.id, stageFrom: p.stageFrom };
      this.ponticMeshes.set(p.id, mesh);
      this.viewer?.scene.add(mesh);
    }
    this.updatePontics();
  }

  private updatePontics(stageOverride?: number) {
    const { settings } = getState();
    const stage = stageOverride ?? getState().stage;
    for (const mesh of this.ponticMeshes.values()) {
      const id = mesh.userData.id as number;
      mesh.position.copy(this.ponticShift(id, stage));
      mesh.visible = stage >= (mesh.userData.stageFrom as number) && (archOf(id) === 'upper' ? settings.showUpper : settings.showLower);
    }
    this.viewer?.requestRender();
  }

  addPontic(id: number) {
    const { plan } = getState();
    const source = contralateral(id);
    if (!this.models[archOf(id)]?.teeth().includes(source)) {
      toast(`Pontic ${id} needs the contralateral tooth ${source} to be segmented.`, 'error');
      return;
    }
    const pontics = (plan.pontics ?? []).filter((p) => p.id !== id);
    pontics.push({ id, source, offset: [0, 0, 0], stageFrom: 0 });
    this.setPlan({ ...plan, pontics });
  }

  updatePontic(id: number, patch: Partial<{ offset: [number, number, number]; stageFrom: number }>) {
    const { plan } = getState();
    this.setPlan({ ...plan, pontics: (plan.pontics ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  }

  removePontic(id: number) {
    const { plan } = getState();
    this.setPlan({ ...plan, pontics: (plan.pontics ?? []).filter((p) => p.id !== id) });
  }

  // ───────────────────────────── roots ─────────────────────────────
  rebuildRoots() {
    for (const mesh of this.rootMeshes.values()) {
      this.viewer?.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.rootMeshes.clear();
    const { frames } = getState();
    for (const f of Object.values(frames)) {
      const m = this.models[archOf(f.id)];
      if (!m) continue;
      const g = buildRootGeometry(m, f);
      if (!g) continue;
      const mesh = new Mesh(g, this.rootMaterials[archOf(f.id)]);
      mesh.matrixAutoUpdate = false;
      mesh.userData.tooth = f.id;
      this.rootMeshes.set(f.id, mesh);
      this.viewer?.scene.add(mesh);
    }
    this.updateRootMeshes();
  }

  private updateRootMeshes(stageOverride?: number) {
    const { layers, settings, plan } = getState();
    const stage = stageOverride ?? getState().stage;
    for (const arch of ARCHES) {
      const st = layers[arch === 'upper' ? 'upperRoots' : 'lowerRoots'];
      const mat = this.rootMaterials[arch];
      mat.color.set(st.color);
      const transparent = st.opacity < 0.999;
      if (mat.transparent !== transparent) mat.needsUpdate = true;
      mat.transparent = transparent;
      mat.opacity = st.opacity;
      mat.depthWrite = !transparent;
    }
    const T = this.transformsAt(stage);
    for (const mesh of this.rootMeshes.values()) {
      const id = mesh.userData.tooth as number;
      const arch = archOf(id);
      const st = layers[arch === 'upper' ? 'upperRoots' : 'lowerRoots'];
      mesh.visible = st.visible && (arch === 'upper' ? settings.showUpper : settings.showLower) && !plan.teeth[id]?.extracted;
      mesh.matrix.copy(T.get(id) ?? new Matrix4());
      mesh.matrixWorldNeedsUpdate = true;
    }
    this.viewer?.requestRender();
  }

  // ───────────────────────────── reset ─────────────────────────────
  resetCase() {
    for (const arch of ARCHES) this.viewer?.setArchGeometry(arch, null, null);
    this.models = {};
    this.raw = {};
    this.bases = {};
    this.orientation = new Matrix4();
    for (const mesh of this.rootMeshes.values()) this.viewer?.scene.remove(mesh);
    this.rootMeshes.clear();
    this.clearAttachmentMeshes();
    this.bodies.clear();
    this.samples.clear();
    this.undoStack = [];
    this.redoStack = [];
    setState({
      arches: { upper: null, lower: null },
      teeth: [],
      frames: {},
      plan: emptyPlan(),
      staging: null,
      issues: [],
      contacts: null,
      stage: 0,
      selectedTooth: null,
      measurements: [],
      aiRationale: null,
      oriented: false,
    });
    this.rebuildGhosts();
  }
}

export const studio = new Studio();

function isIdentity(m: Matrix4): boolean {
  const id = new Matrix4().elements;
  return m.elements.every((v, i) => Math.abs(v - id[i]) < 1e-12);
}
