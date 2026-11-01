import { BufferAttribute, BufferGeometry, Color, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Arch } from '../core/fdi';
import { adjacentPairs, archOf, contactKey, sequence, toothNumber } from '../core/fdi';
import { computeStaging, movementAtStage } from '../core/staging';
import type { StagingToothInput } from '../core/staging';
import { movementMatrix, v3 } from '../core/transform';
import type { Attachment, ContactReport, Movement, Protocol, ToothFrame, ToothPlan, TreatmentPlan } from '../core/types';
import { isZeroMovement, zeroMovement } from '../core/types';
import { suggestIpr, triggeredAttachmentRules, validatePlan } from '../core/validate';
import { newAttachment } from '../core/aiBrief';
import { ArchModel, seedRadiusMm } from '../geometry/archModel';
import { attachmentGeometry } from '../geometry/attachments';
import { ToothBody, contactDistance } from '../geometry/contacts';
import { makeDemoArch } from '../geometry/demo';
import { computeArchFrames, crownSamples } from '../geometry/frames';
import { parseScan, writeBinaryStl } from '../geometry/io';
import { COLORS, Viewer } from './viewer';
import type { Hit, PatientAxes } from './viewer';
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
      }
      if (s.settings !== prev.settings) this.applySettings(prev.settings.gingivaFlexMm !== s.settings.gingivaFlexMm);
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
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (m) v.setArchGeometry(arch, m.geometry, null);
    }
    this.rebuildGhosts();
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
    setState((s) => ({ caseInfo: { ...s.caseInfo, patientName: s.caseInfo.patientName || 'Demo patient', caseId: s.caseInfo.caseId || 'DEMO-001' } }));
    this.afterSegmentation(true);
    this.setView('front');
  }

  // ───────────────────────────── segmentation ─────────────────────────────
  private segRadius = (tooth: number) => seedRadiusMm(tooth, getState().settings.seedReachScale);

  resegment(arch: Arch) {
    const m = this.models[arch];
    if (!m) return;
    m.segment(this.segRadius, getState().settings.segTightness);
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
    if (s.tool === 'seed' && hit) {
      const m = this.models[hit.arch]!;
      const tooth = s.activeTooth;
      if (archOf(tooth) !== hit.arch) {
        toast(`Tooth ${tooth} belongs to the ${archOf(tooth)} arch — click on that arch or pick another tooth.`, 'error');
        return;
      }
      this.pushSeg(hit.arch);
      const v = m.nearestVertexOfFace(hit.face, hit.point);
      if (!ev.shiftKey) m.seeds = m.seeds.filter((x) => x.tooth !== tooth);
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
    const seq = sequence(arch).filter((t) => toothNumber(t) !== 8);
    const segmented = new Set(this.models[arch]?.teeth() ?? []);
    const i = seq.indexOf(s.activeTooth);
    for (let k = 1; k < seq.length; k++) {
      const next = seq[(i + k) % seq.length];
      if (!segmented.has(next)) {
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
    this.samples.clear();
    for (const arch of ARCHES) this.models[arch]?.invalidate();
    const teeth = ARCHES.flatMap((a) => this.models[a]?.teeth() ?? []).sort((a, b) => a - b);
    setState({ teeth });
    this.updateColors();
    this.rebuildGhosts();
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
      if (m) Object.assign(frames, computeArchFrames(m, protocol));
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
    const movement = { ...tp.movement };
    for (const [k, v] of Object.entries(patch)) movement[k as keyof Movement] = Math.round((v as number) * 1000) / 1000;
    this.updateTooth(id, { movement }, record);
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
    const { protocol, plan, contacts, stage } = getState();
    const staging = computeStaging(protocol, this.stagingInputs());
    const issues = validatePlan(protocol, plan, staging, contacts ? contacts.filter((c) => c.stage > 0) : null);
    setState({ staging, issues, stage: Math.min(stage, staging.totalStages) });
    this.applyStage();
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

  applyStage() {
    const v = this.viewer;
    const { stage } = getState();
    for (const arch of ARCHES) {
      const m = this.models[arch];
      if (!m) continue;
      m.deform(this.transformsAt(stage, arch));
      v?.markGeometryChanged(arch);
    }
    this.updateAttachmentMeshes();
    this.updateAxes();
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

  private updateAttachmentMeshes() {
    const v = this.viewer;
    const { plan, stage, settings } = getState();
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
    const { step, selectedTooth, plan, activeTooth } = getState();
    const segmenting = step === 'segment' || step === 'import';
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
        if (!l) col = anyTeeth ? COLORS.gingiva : COLORS.scan;
        else {
          col = cache.get(l)!;
          if (!col) {
            if (segmenting) col = l === activeTooth ? COLORS.selected : toothHue(l);
            else if (l === selectedTooth) col = COLORS.selected;
            else if (plan.teeth[l]?.locked || plan.teeth[l]?.extracted) col = COLORS.locked;
            else col = COLORS.tooth;
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

  private updateAxes() {
    const v = this.viewer;
    if (!v) return;
    const { selectedTooth, frames, settings, step, stage } = getState();
    if (!settings.showAxes || selectedTooth === null || !frames[selectedTooth] || step === 'segment' || step === 'import') {
      v.setAxes([]);
      return;
    }
    const f = frames[selectedTooth];
    const T = this.transformsAt(stage).get(selectedTooth) ?? new Matrix4();
    const origin = v3(f.centroid).applyMatrix4(T);
    const dir = (d: [number, number, number]) => v3(d).transformDirection(T);
    v.setAxes([{ origin, dirs: [[dir(f.mesial), 0xef4444], [dir(f.buccal), 0x22c55e], [dir(f.occlusal), 0x3b82f6]] }]);
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

  // ───────────────────────────── reset ─────────────────────────────
  resetCase() {
    for (const arch of ARCHES) this.viewer?.setArchGeometry(arch, null, null);
    this.models = {};
    this.raw = {};
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
    });
    this.rebuildGhosts();
  }
}

export const studio = new Studio();
