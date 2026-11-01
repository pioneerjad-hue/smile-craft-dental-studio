import {
  ConeGeometry,
  CylinderGeometry,
  GridHelper,
  Plane,
  Quaternion,
  Ray,
  TorusGeometry,
  AmbientLight,
  BufferAttribute,
  ArrowHelper,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MOUSE,
  Object3D,
  OrthographicCamera,
  Raycaster,
  RingGeometry,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { Arch } from '../core/fdi';
import type { Measurement, MovementKey } from '../core/types';
import type { View } from './store';

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

export interface Hit {
  arch: Arch;
  face: number;
  point: Vector3;
  normal: Vector3;
}

export interface GizmoHandle {
  kind: 'translate' | 'rotate';
  key: MovementKey;
  axis: Vector3;
}

export interface GizmoSpec {
  origin: Vector3;
  mesial: Vector3;
  buccal: Vector3;
  occlusal: Vector3;
}

export interface PatientAxes {
  center: Vector3;
  up: Vector3;
  anterior: Vector3;
  right: Vector3;
  size: number;
}

export class Viewer {
  readonly container: HTMLElement;
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: OrthographicCamera;
  readonly controls: OrbitControls;
  /** Full-arch meshes used for picking only (never drawn). */
  readonly archMeshes: Record<Arch, Mesh | null> = { upper: null, lower: null };
  /** Drawn layers per arch; gum and teeth share the arch's vertex buffers. */
  readonly layerMeshes: Record<Arch, { gum: Mesh; teeth: Mesh; base: Mesh | null } | null> = { upper: null, lower: null };
  private layerMaterials = new Map<string, MeshStandardMaterial>();
  private pickMaterial = new MeshBasicMaterial({ visible: false });
  readonly ghostMeshes: Record<Arch, Mesh | null> = { upper: null, lower: null };
  readonly attachmentGroup = new Group();
  readonly axesGroup = new Group();
  readonly measureGroup = new Group();
  readonly overlay: HTMLDivElement;
  readonly brushCursor: Mesh;
  private needsRender = true;
  private frame = 0;
  private bvhDirty: Record<Arch, boolean> = { upper: true, lower: true };
  private viewHeight = 90;
  private measureLabels: { el: HTMLDivElement; pos: Vector3 }[] = [];

  readonly gizmo = new Group();
  readonly guides = new Group();
  private gizmoDrag: { handle: GizmoHandle; origin: Vector3; t0: number; v0: Vector3 } | null = null;
  private toothLabels: { el: HTMLDivElement; pos: Vector3 }[] = [];
  onGizmo: (handle: GizmoHandle, delta: number, phase: 'start' | 'move' | 'end') => void = () => {};
  onClick: (hit: Hit | null, ev: PointerEvent) => void = () => {};
  onPaint: (hit: Hit, phase: 'start' | 'move' | 'end') => void = () => {};
  paintMode = false;
  brushRadius = 1;

  readonly toothMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.0, side: DoubleSide });
  // Pushed back in depth so the initial-position overlay is hidden where a tooth has not moved.
  readonly ghostMaterial = new MeshBasicMaterial({ color: 0x3d8bfd, transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 });

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);
    this.overlay = document.createElement('div');
    this.overlay.className = 'viewer-overlay';
    container.appendChild(this.overlay);

    this.camera = new OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
    this.camera.position.set(0, -200, 40);
    this.camera.up.set(0, 0, 1);
    this.scene.add(this.camera);
    this.scene.add(new AmbientLight(0xffffff, 0.35));
    this.scene.add(new HemisphereLight(0xffffff, 0x8a7f7a, 0.55));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(30, 40, 100);
    this.camera.add(key);
    const fill = new DirectionalLight(0xffffff, 0.5);
    fill.position.set(-60, -20, 40);
    this.camera.add(fill);

    this.scene.add(this.attachmentGroup, this.axesGroup, this.measureGroup, this.gizmo, this.guides);
    this.gizmo.visible = false;
    this.guides.visible = false;
    this.buildGuides();
    this.brushCursor = new Mesh(new RingGeometry(0.9, 1, 48), new MeshBasicMaterial({ color: 0x22c55e, side: DoubleSide, depthTest: false, transparent: true }));
    this.brushCursor.renderOrder = 10;
    this.brushCursor.visible = false;
    this.scene.add(this.brushCursor);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => this.requestRender());
    this.setPaintMode(false);
    this.installPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      if (this.needsRender) {
        this.needsRender = false;
        this.renderer.render(this.scene, this.camera);
        this.updateLabels();
      }
    };
    loop();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }

  requestRender() {
    this.needsRender = true;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    const aspect = w / h;
    const H = this.viewHeight;
    this.camera.left = (-H * aspect) / 2;
    this.camera.right = (H * aspect) / 2;
    this.camera.top = H / 2;
    this.camera.bottom = -H / 2;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  setPaintMode(on: boolean) {
    this.paintMode = on;
    this.controls.mouseButtons = on
      ? ({ LEFT: -1, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE } as never)
      : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    if (!on) this.brushCursor.visible = false;
    this.requestRender();
  }

  layerMaterial(key: string, vertexColors = true): MeshStandardMaterial {
    let m = this.layerMaterials.get(key);
    if (!m) {
      m = new MeshStandardMaterial({ vertexColors, roughness: 0.52, metalness: 0, side: DoubleSide });
      this.layerMaterials.set(key, m);
    }
    return m;
  }

  setArchGeometry(arch: Arch, geometry: BufferGeometry | null, ghostGeometry: BufferGeometry | null) {
    const old = this.archMeshes[arch];
    if (old) {
      this.scene.remove(old);
      (old.geometry as BufferGeometry).disposeBoundsTree?.();
    }
    const oldLayers = this.layerMeshes[arch];
    if (oldLayers) {
      for (const m of [oldLayers.gum, oldLayers.teeth, oldLayers.base]) if (m) this.scene.remove(m);
    }
    const oldGhost = this.ghostMeshes[arch];
    if (oldGhost) this.scene.remove(oldGhost);
    this.archMeshes[arch] = null;
    this.layerMeshes[arch] = null;
    this.ghostMeshes[arch] = null;
    if (geometry) {
      const mesh = new Mesh(geometry, this.pickMaterial);
      mesh.userData.arch = arch;
      this.scene.add(mesh);
      this.archMeshes[arch] = mesh;
      this.bvhDirty[arch] = true;
      const shared = (index: number[]) => {
        const g = new BufferGeometry();
        for (const name of ['position', 'normal', 'color']) {
          const a = geometry.getAttribute(name);
          if (a) g.setAttribute(name, a);
        }
        g.setIndex(index);
        return g;
      };
      const all = Array.from(geometry.index!.array as ArrayLike<number>);
      const gum = new Mesh(shared(all), this.layerMaterial(`${arch}Gum`));
      const teeth = new Mesh(shared([]), this.layerMaterial(`${arch}Teeth`));
      for (const m of [gum, teeth]) {
        m.frustumCulled = false;
        this.scene.add(m);
      }
      this.layerMeshes[arch] = { gum, teeth, base: null };
    }
    if (ghostGeometry) {
      const ghost = new Mesh(ghostGeometry, this.ghostMaterial);
      ghost.renderOrder = 5;
      ghost.visible = false;
      this.scene.add(ghost);
      this.ghostMeshes[arch] = ghost;
    }
    this.requestRender();
  }

  /** Split the arch into gum and teeth layers (face index lists). */
  setLayerIndex(arch: Arch, gum: Uint32Array, teeth: Uint32Array) {
    const l = this.layerMeshes[arch];
    if (!l) return;
    l.gum.geometry.setIndex(new BufferAttribute(gum, 1));
    l.teeth.geometry.setIndex(new BufferAttribute(teeth, 1));
    this.requestRender();
  }

  setBaseGeometry(arch: Arch, geometry: BufferGeometry | null) {
    const l = this.layerMeshes[arch];
    if (!l) return;
    if (l.base) {
      this.scene.remove(l.base);
      l.base.geometry.dispose();
      l.base = null;
    }
    if (geometry) {
      l.base = new Mesh(geometry, this.layerMaterial(`${arch}Base`, false));
      this.scene.add(l.base);
    }
    this.requestRender();
  }

  applyLayers(layers: Record<string, { visible: boolean; opacity: number; color: string }>, archVisible: Record<Arch, boolean>) {
    for (const arch of ['upper', 'lower'] as Arch[]) {
      const l = this.layerMeshes[arch];
      if (!l) continue;
      const parts: [Mesh | null, string][] = [
        [l.gum, `${arch}Gum`],
        [l.teeth, `${arch}Teeth`],
        [l.base, `${arch}Base`],
      ];
      for (const [mesh, key] of parts) {
        const style = layers[key];
        if (!mesh || !style) continue;
        mesh.visible = archVisible[arch] && style.visible && style.opacity > 0.01;
        const mat = mesh.material as MeshStandardMaterial;
        const transparent = style.opacity < 0.999;
        if (mat.transparent !== transparent) mat.needsUpdate = true;
        mat.transparent = transparent;
        mat.opacity = style.opacity;
        mat.depthWrite = !transparent;
        if (!mat.vertexColors) mat.color.set(style.color);
        mesh.renderOrder = transparent ? 2 : 0;
      }
    }
    this.requestRender();
  }

  setGhostGeometry(arch: Arch, geometry: BufferGeometry | null) {
    const oldGhost = this.ghostMeshes[arch];
    if (oldGhost) this.scene.remove(oldGhost);
    this.ghostMeshes[arch] = null;
    if (geometry) {
      const ghost = new Mesh(geometry, this.ghostMaterial);
      ghost.renderOrder = 5;
      this.scene.add(ghost);
      this.ghostMeshes[arch] = ghost;
    }
  }

  markGeometryChanged(arch: Arch) {
    this.bvhDirty[arch] = true;
    this.requestRender();
  }

  private ensureBvh(arch: Arch) {
    const mesh = this.archMeshes[arch];
    if (!mesh) return;
    const g = mesh.geometry as BufferGeometry;
    if (!g.boundsTree) {
      g.computeBoundsTree();
    } else if (this.bvhDirty[arch]) {
      g.boundsTree.refit();
    }
    this.bvhDirty[arch] = false;
  }

  pick(clientX: number, clientY: number): Hit | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    (ray as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const targets: Mesh[] = [];
    for (const arch of ['upper', 'lower'] as Arch[]) {
      const m = this.archMeshes[arch];
      if (m && m.visible) {
        this.ensureBvh(arch);
        targets.push(m);
      }
    }
    const hits = ray.intersectObjects(targets, false);
    const h = hits[0];
    if (!h || h.faceIndex === undefined || h.faceIndex === null) return null;
    const normal = h.face ? h.face.normal.clone() : new Vector3(0, 0, 1);
    if (normal.dot(ray.ray.direction) > 0) normal.negate();
    return { arch: h.object.userData.arch as Arch, face: h.faceIndex, point: h.point.clone(), normal };
  }

  private installPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; button: number } | null = null;
    let painting = false;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, button: e.button };
      if (e.button === 0 && this.gizmo.visible) {
        const h = this.pickGizmo(e.clientX, e.clientY);
        if (h) {
          const ray = this.rayAt(e.clientX, e.clientY);
          const origin = this.gizmo.position.clone();
          this.gizmoDrag = { handle: h, origin, t0: this.lineParam(ray, origin, h.axis), v0: this.planeVector(ray, origin, h.axis) ?? new Vector3(1, 0, 0) };
          this.controls.enabled = false;
          el.setPointerCapture(e.pointerId);
          this.onGizmo(h, 0, 'start');
          down = null;
          return;
        }
      }
      if (this.paintMode && e.button === 0) {
        const hit = this.pick(e.clientX, e.clientY);
        if (hit) {
          painting = true;
          el.setPointerCapture(e.pointerId);
          this.onPaint(hit, 'start');
        }
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (this.gizmoDrag) {
        const g = this.gizmoDrag;
        const ray = this.rayAt(e.clientX, e.clientY);
        let delta = 0;
        if (g.handle.kind === 'translate') delta = this.lineParam(ray, g.origin, g.handle.axis) - g.t0;
        else {
          const v = this.planeVector(ray, g.origin, g.handle.axis);
          if (v) delta = Math.atan2(g.handle.axis.dot(new Vector3().crossVectors(g.v0, v)), g.v0.dot(v));
        }
        this.onGizmo(g.handle, delta, 'move');
        return;
      }
      if (this.gizmo.visible && !this.paintMode) {
        el.style.cursor = this.pickGizmo(e.clientX, e.clientY) ? 'grab' : this.defaultCursor;
      }
      if (this.paintMode) {
        const hit = this.pick(e.clientX, e.clientY);
        this.updateCursor(hit);
        if (painting && hit) this.onPaint(hit, 'move');
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (this.gizmoDrag) {
        this.onGizmo(this.gizmoDrag.handle, 0, 'end');
        this.gizmoDrag = null;
        this.controls.enabled = true;
        return;
      }
      if (painting) {
        painting = false;
        const hit = this.pick(e.clientX, e.clientY);
        if (hit) this.onPaint(hit, 'end');
        else this.onPaint({ arch: 'upper', face: -1, point: new Vector3(), normal: new Vector3() }, 'end');
        down = null;
        return;
      }
      if (down && down.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        this.onClick(this.pick(e.clientX, e.clientY), e);
      }
      down = null;
    });
    el.addEventListener('pointerleave', () => {
      this.brushCursor.visible = false;
      this.requestRender();
    });
  }

  private updateCursor(hit: Hit | null) {
    if (!hit) {
      this.brushCursor.visible = false;
    } else {
      this.brushCursor.visible = true;
      this.brushCursor.position.copy(hit.point).addScaledVector(hit.normal, 0.05);
      this.brushCursor.lookAt(hit.point.clone().add(hit.normal));
      this.brushCursor.scale.setScalar(this.brushRadius);
    }
    this.requestRender();
  }

  setBrushColor(color: number) {
    (this.brushCursor.material as MeshBasicMaterial).color.set(color);
  }

  /** Bounding info of visible arches in scene coordinates. */
  bounds(): Box3 {
    const box = new Box3();
    for (const arch of ['upper', 'lower'] as Arch[]) {
      const m = this.archMeshes[arch];
      if (m && m.visible) {
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!);
      }
    }
    return box;
  }

  setView(view: View, axes: PatientAxes) {
    const { center, up, anterior, right, size } = axes;
    const dist = 400;
    let dir: Vector3;
    let camUp: Vector3;
    switch (view) {
      case 'front':
        dir = anterior.clone();
        camUp = up.clone();
        break;
      case 'right':
        dir = right.clone();
        camUp = up.clone();
        break;
      case 'left':
        dir = right.clone().negate();
        camUp = up.clone();
        break;
      case 'upperOcclusal':
        dir = up.clone().negate();
        camUp = anterior.clone();
        break;
      case 'lowerOcclusal':
        dir = up.clone();
        camUp = anterior.clone();
        break;
    }
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.up.copy(camUp);
    this.controls.target.copy(center);
    this.viewHeight = Math.max(30, size * 1.15);
    this.camera.zoom = 1;
    this.resize();
    this.camera.lookAt(center);
    this.controls.update();
    this.requestRender();
  }

  setAxes(items: { origin: Vector3; dirs: [Vector3, number][]; length?: number }[]) {
    this.axesGroup.clear();
    for (const it of items) {
      const len = it.length ?? 7;
      for (const [d, color] of it.dirs) {
        const a = new ArrowHelper(d, it.origin, len, color, len * 0.2, len * 0.11);
        (a.line.material as LineBasicMaterial).depthTest = false;
        (a.cone.material as MeshBasicMaterial).depthTest = false;
        a.renderOrder = 20;
        a.line.renderOrder = 20;
        a.cone.renderOrder = 20;
        this.axesGroup.add(a);
      }
    }
    this.requestRender();
  }

  setMeasurements(list: Measurement[], pending: Vector3 | null) {
    this.measureGroup.clear();
    for (const l of this.measureLabels) l.el.remove();
    this.measureLabels = [];
    const dotGeo = new RingGeometry(0, 0.35, 16);
    const mat = new LineBasicMaterial({ color: 0xf59e0b, depthTest: false });
    const dotMat = new MeshBasicMaterial({ color: 0xf59e0b, depthTest: false, side: DoubleSide });
    const addDot = (p: Vector3) => {
      const d = new Mesh(dotGeo, dotMat);
      d.position.copy(p);
      d.renderOrder = 30;
      d.onBeforeRender = () => d.quaternion.copy(this.camera.quaternion);
      this.measureGroup.add(d);
      return d;
    };
    for (const m of list) {
      const a = new Vector3(...m.a);
      const b = new Vector3(...m.b);
      const line = new Line(new BufferGeometry().setFromPoints([a, b]), mat);
      line.renderOrder = 30;
      this.measureGroup.add(line);
      addDot(a);
      addDot(b);
      const el = document.createElement('div');
      el.className = 'measure-label';
      el.textContent = m.label;
      this.overlay.appendChild(el);
      this.measureLabels.push({ el, pos: a.clone().add(b).multiplyScalar(0.5) });
    }
    if (pending) addDot(pending);
    this.requestRender();
  }

  private updateLabels() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    for (const { el, pos } of [...this.measureLabels, ...this.toothLabels]) {
      const p = pos.clone().project(this.camera);
      el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -140%)`;
    }
  }

  setVisible(obj: Object3D | null, visible: boolean) {
    if (obj) obj.visible = visible;
    this.requestRender();
  }

  defaultCursor = 'default';

  private rayAt(clientX: number, clientY: number): Ray {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc.ray.clone();
  }

  /** Parameter along line (origin, axis) of the point closest to the ray (mm). */
  private lineParam(ray: Ray, origin: Vector3, axis: Vector3): number {
    const w0 = ray.origin.clone().sub(origin);
    const b = ray.direction.dot(axis);
    const denom = 1 - b * b;
    if (denom < 1e-6) return 0;
    return (axis.dot(w0) - b * ray.direction.dot(w0)) / denom;
  }

  /** Vector from origin to the ray's hit on the plane ⟂ axis through origin. */
  private planeVector(ray: Ray, origin: Vector3, axis: Vector3): Vector3 | null {
    const hit = ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(axis, origin), new Vector3());
    return hit ? hit.sub(origin) : null;
  }

  private pickGizmo(clientX: number, clientY: number): GizmoHandle | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hits = rc.intersectObjects(this.gizmo.children, true);
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && !o.userData.handle) o = o.parent;
      if (o) return o.userData.handle as GizmoHandle;
    }
    return null;
  }

  /**
   * Tooth-movement navigator: double arrows translate along the tooth's mesial (red), buccal (green)
   * and long (blue) axes; rings rotate it (rotation = cyan, tip = orange, torque = violet).
   */
  setGizmo(spec: GizmoSpec | null) {
    this.gizmo.clear();
    this.gizmo.visible = !!spec;
    if (!spec) return this.requestRender();
    this.gizmo.position.copy(spec.origin);
    const M = spec.mesial, B = spec.buccal, O = spec.occlusal;
    const up = new Vector3(0, 1, 0);
    const mat = (color: number) => new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    const pickMat = new MeshBasicMaterial({ visible: false });
    const arrow = (axis: Vector3, color: number, key: MovementKey) => {
      const g = new Group();
      const len = 7;
      const shaft = new Mesh(new CylinderGeometry(0.16, 0.16, 2 * len, 8), mat(color));
      const head1 = new Mesh(new ConeGeometry(0.6, 1.6, 14), mat(color));
      head1.position.y = len;
      const head2 = new Mesh(new ConeGeometry(0.6, 1.6, 14), mat(color));
      head2.position.y = -len;
      head2.rotation.x = Math.PI;
      const pick = new Mesh(new CylinderGeometry(0.9, 0.9, 2 * len + 3, 8), pickMat);
      g.add(shaft, head1, head2, pick);
      g.quaternion.copy(new Quaternion().setFromUnitVectors(up, axis.clone().normalize()));
      g.userData.handle = { kind: 'translate', key, axis: axis.clone().normalize() } satisfies GizmoHandle;
      return g;
    };
    const ring = (axis: Vector3, color: number, key: MovementKey, r: number) => {
      const g = new Group();
      const torus = new Mesh(new TorusGeometry(r, 0.14, 8, 64), mat(color));
      const pick = new Mesh(new TorusGeometry(r, 0.7, 6, 48), pickMat);
      g.add(torus, pick);
      g.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), axis.clone().normalize()));
      g.userData.handle = { kind: 'rotate', key, axis: axis.clone().normalize() } satisfies GizmoHandle;
      return g;
    };
    this.gizmo.add(
      arrow(M, 0xef4444, 'mesial'),
      arrow(B, 0x22c55e, 'buccal'),
      arrow(O, 0x3b82f6, 'extrusion'),
      ring(new Vector3().crossVectors(B, M), 0x22d3ee, 'rotation', 5),
      ring(new Vector3().crossVectors(O, M), 0xf59e0b, 'tip', 5.8),
      ring(new Vector3().crossVectors(O, B), 0xa78bfa, 'torque', 6.6),
    );
    this.gizmo.traverse((o) => (o.renderOrder = 50));
    this.requestRender();
  }

  /** Occlusal-plane grid and midline guides for the orientation step (patient coordinates). */
  private buildGuides() {
    const grid = new GridHelper(100, 20, 0x38bdf8, 0x24314d);
    grid.rotation.x = Math.PI / 2; // XY plane = occlusal plane
    (grid.material as LineBasicMaterial).transparent = true;
    (grid.material as LineBasicMaterial).opacity = 0.6;
    const line = (a: Vector3, b: Vector3, color: number) => new Line(new BufferGeometry().setFromPoints([a, b]), new LineBasicMaterial({ color, depthTest: false }));
    this.guides.add(grid, line(new Vector3(0, -60, 0), new Vector3(0, 60, 0), 0xef4444), line(new Vector3(-60, 0, 0), new Vector3(60, 0, 0), 0x22c55e));
  }

  setGuides(visible: boolean) {
    this.guides.visible = visible;
    this.requestRender();
  }

  /** Tooth-number labels floating over the crowns. */
  setToothLabels(list: { text: string; pos: Vector3 }[]) {
    for (const l of this.toothLabels) l.el.remove();
    this.toothLabels = list.map(({ text, pos }) => {
      const el = document.createElement('div');
      el.className = 'tooth-label';
      el.textContent = text;
      this.overlay.appendChild(el);
      return { el, pos };
    });
    this.requestRender();
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  boundingSphere(): Sphere {
    return this.bounds().getBoundingSphere(new Sphere());
  }
}

export const COLORS = {
  scan: new Color(0.86, 0.83, 0.79),
  gingiva: new Color(0.87, 0.56, 0.6),
  tooth: new Color(0.96, 0.94, 0.88),
  selected: new Color(0.62, 0.8, 1.0),
  locked: new Color(0.75, 0.75, 0.78),
};
