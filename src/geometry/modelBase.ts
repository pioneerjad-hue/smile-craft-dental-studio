import { ShapeUtils, Vector2, Vector3 } from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';
// Helvetiker Bold (MgOpen, © 2004 MAGENTA Ltd., permissive licence — see THIRD_PARTY_NOTICES.md)
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json';
import type { ArchModel } from './archModel';

/**
 * Model builder: closes an open intraoral scan into a printable solid.
 * The outer scan border is extruded along the apical direction to a flat plane `thicknessMm`
 * beyond the most apical scan point, and that plane is capped. Any other (small) holes in the scan
 * are filled flat. The base only references border vertices, which the staging deformation never
 * moves, so one base is valid for every stage.
 */
export interface BaseOptions {
  /** Distance of the flat base plane beyond the most apical point of the scan (mm). */
  thicknessMm: number;
  /** Text engraved into the flat bottom (e.g. "SC-0142 U07"), read from below. */
  label?: string;
  labelDepthMm?: number;
  /** Direction the top of the text should point to (default: patient anterior). */
  labelUp?: Vector3;
}

let font: Font | null = null;
function getFont(): Font {
  if (!font) font = new FontLoader().parse(helvetikerBold as never);
  return font;
}

export interface ModelBase {
  /** New vertices (flat-plane copies of the border), indexed from `vertexOffset`. */
  positions: Float32Array;
  vertexOffset: number;
  /** Triangles referencing scan vertices (< vertexOffset) and new vertices (>= vertexOffset). */
  index: Uint32Array;
  borderLength: number;
  holesFilled: number;
  /** False when a label was requested but did not fit on the base. */
  labelPlaced: boolean;
}

/** Directed boundary loops (edge direction as in the faces that own them). */
export function boundaryLoops(index: ArrayLike<number>, vertexCount: number): number[][] {
  const n = vertexCount;
  const count = new Map<number, number>();
  const directed: [number, number][] = [];
  for (let f = 0; f < index.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[f + k], b = index[f + ((k + 1) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  for (let f = 0; f < index.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[f + k], b = index[f + ((k + 1) % 3)];
      if (count.get(a < b ? a * n + b : b * n + a) === 1) directed.push([a, b]);
    }
  }
  const next = new Map<number, number[]>();
  for (const [a, b] of directed) {
    const l = next.get(a);
    if (l) l.push(b);
    else next.set(a, [b]);
  }
  const loops: number[][] = [];
  for (const [start] of directed) {
    if (!next.get(start)?.length) continue;
    const loop: number[] = [start];
    let cur = start;
    for (let guard = 0; guard < directed.length + 1; guard++) {
      const outs = next.get(cur);
      if (!outs || !outs.length) break;
      const nx = outs.pop()!;
      if (nx === start) break;
      loop.push(nx);
      cur = nx;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops.sort((a, b) => b.length - a.length);
}

/** Number of edges not shared by exactly two faces (0 = closed / watertight surface). */
export function openEdgeCount(index: ArrayLike<number>, vertexCount: number): number {
  const n = vertexCount;
  const count = new Map<number, number>();
  for (let f = 0; f < index.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[f + k], b = index[f + ((k + 1) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const c of count.values()) if (c !== 2) open++;
  return open;
}

/** Triangulate a loop in the plane ⟂ normal so that the fill closes the loop (opposite winding). */
export function fillLoop(loop: number[], pos: (i: number) => Vector3, e1: Vector3, e2: Vector3, out: number[]) {
  const pts = loop.map((i) => {
    const p = pos(i);
    return new Vector2(p.dot(e1), p.dot(e2));
  });
  const loopArea = ShapeUtils.area(pts);
  const tris = ShapeUtils.triangulateShape(pts, []);
  for (const [a, b, c] of tris) {
    const t = ShapeUtils.area([pts[a], pts[b], pts[c]]);
    // A fill triangle must traverse the shared edges opposite to the loop direction.
    if (Math.sign(t) === Math.sign(loopArea)) out.push(loop[a], loop[c], loop[b]);
    else out.push(loop[a], loop[b], loop[c]);
  }
}

export function buildModelBase(model: ArchModel, occlusal: Vector3, opts: BaseOptions): ModelBase | null {
  const loops = boundaryLoops(model.index, model.vertexCount);
  if (!loops.length) return null; // already closed (e.g. a model scan with base)
  const O = occlusal.clone().normalize();
  const e1 = Math.abs(O.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  e1.addScaledVector(O, -e1.dot(O)).normalize();
  const e2 = new Vector3().crossVectors(O, e1).normalize();
  let minH = Infinity;
  for (let i = 0; i < model.vertexCount; i++) {
    const h = model.base[3 * i] * O.x + model.base[3 * i + 1] * O.y + model.base[3 * i + 2] * O.z;
    if (h < minH) minH = h;
  }
  const level = minH - Math.max(0.5, opts.thicknessMm);
  const outer = loops[0];
  const N = model.vertexCount;
  const positions = new Float32Array(outer.length * 3);
  const flatIndex = new Map<number, number>();
  const v = new Vector3();
  outer.forEach((vi, k) => {
    model.position(vi, v);
    v.addScaledVector(O, level - v.dot(O));
    positions.set([v.x, v.y, v.z], 3 * k);
    flatIndex.set(vi, N + k);
  });
  const tris: number[] = [];
  // Walls: for border edge a→b, add (b, a, a') and (b, a', b').
  for (let k = 0; k < outer.length; k++) {
    const a = outer[k], b = outer[(k + 1) % outer.length];
    const a2 = flatIndex.get(a)!, b2 = flatIndex.get(b)!;
    tris.push(b, a, a2, b, a2, b2);
  }
  const posOf = (i: number) => (i >= N ? new Vector3().fromArray(positions, 3 * (i - N)) : model.position(i));
  const capLoop = outer.map((i) => flatIndex.get(i)!);
  const extraPos: number[] = [];
  const label = opts.label?.trim() ? placeLabel(capLoop.map(posOf), O, opts.label.trim().toUpperCase(), opts.labelUp ?? new Vector3(0, 1, 0)) : null;
  if (label) {
    engraveLabel(capLoop, posOf, label, O, opts.labelDepthMm ?? 0.6, N + outer.length, extraPos, tris);
  } else {
    // Cap: the flat loop a'→b' has the same direction as the border, so the same fill rule applies.
    fillLoop(capLoop, posOf, e1, e2, tris);
  }
  // Fill remaining holes in the scan.
  for (const hole of loops.slice(1)) fillLoop(hole, posOf, e1, e2, tris);
  const allPos = new Float32Array(positions.length + extraPos.length);
  allPos.set(positions);
  allPos.set(extraPos, positions.length);
  return { positions: allPos, vertexOffset: N, index: new Uint32Array(tris), borderLength: outer.length, holesFilled: loops.length - 1, labelPlaced: !!label || !opts.label };
}

interface PlacedLabel {
  /** Glyph outlines in 3-D on the cap plane: outer contours and their holes. */
  glyphs: { outer: Vector3[]; holes: Vector3[][] }[];
  X: Vector3;
  Y: Vector3;
}

/**
 * Find where engraved text fits on the flat base (inside the outline with a 1.2 mm margin), trying
 * sizes from 4.5 to 2 mm and rotations in 15° steps, preferring the largest size and clearance.
 * Text reads correctly when the model is viewed from below.
 */
function placeLabel(cap: Vector3[], O: Vector3, text: string, upHint: Vector3): PlacedLabel | null {
  const Nrm = O.clone().negate(); // outward normal of the bottom face
  const Y0 = upHint.clone().addScaledVector(Nrm, -upHint.dot(Nrm)).normalize();
  const X0 = new Vector3().crossVectors(Y0, Nrm).normalize();
  const origin = cap.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / cap.length);
  const poly = cap.map((p) => new Vector2(p.clone().sub(origin).dot(X0), p.clone().sub(origin).dot(Y0)));
  const step = Math.max(1, Math.floor(poly.length / 240));
  const coarse = poly.filter((_, i) => i % step === 0);
  const inside = (q: Vector2) => {
    let c = false;
    for (let i = 0, j = coarse.length - 1; i < coarse.length; j = i++) {
      const a = coarse[i], b = coarse[j];
      if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const edgeDist = (q: Vector2) => {
    let d = Infinity;
    for (let i = 0, j = coarse.length - 1; i < coarse.length; j = i++) {
      const a = coarse[j], b = coarse[i];
      const ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
      d = Math.min(d, a.clone().addScaledVector(ab, t).distanceTo(q));
    }
    return d;
  };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) (minX = Math.min(minX, p.x)), (maxX = Math.max(maxX, p.x)), (minY = Math.min(minY, p.y)), (maxY = Math.max(maxY, p.y));
  const margin = 1.2;
  for (const size of [4.5, 3.5, 3, 2.5, 2]) {
    const shapes = getFont().generateShapes(text, size);
    const pts = shapes.map((sh) => sh.extractPoints(6));
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const g of pts) for (const p of g.shape) (bx0 = Math.min(bx0, p.x)), (bx1 = Math.max(bx1, p.x)), (by0 = Math.min(by0, p.y)), (by1 = Math.max(by1, p.y));
    const w = bx1 - bx0 + 2 * margin, h = by1 - by0 + 2 * margin;
    const rectSamples: Vector2[] = [];
    for (let i = 0; i <= 8; i++) for (const yy of [-h / 2, h / 2]) rectSamples.push(new Vector2(-w / 2 + (w * i) / 8, yy));
    for (let i = 1; i < 3; i++) for (const xx of [-w / 2, w / 2]) rectSamples.push(new Vector2(xx, -h / 2 + (h * i) / 3));
    let best: { score: number; c: Vector2; ang: number } | null = null;
    for (let cx = minX; cx <= maxX; cx += 1.5) {
      for (let cy = minY; cy <= maxY; cy += 1.5) {
        const c = new Vector2(cx, cy);
        if (!inside(c)) continue;
        for (let deg = 0; deg < 180; deg += 15) {
          const a = (deg * Math.PI) / 180;
          const rot = (p: Vector2) => new Vector2(c.x + p.x * Math.cos(a) - p.y * Math.sin(a), c.y + p.x * Math.sin(a) + p.y * Math.cos(a));
          if (!rectSamples.every((p) => inside(rot(p)))) continue;
          const score = Math.min(...rectSamples.map((p) => edgeDist(rot(p)))) - deg * 1e-4;
          if (!best || score > best.score) best = { score, c, ang: a };
        }
      }
    }
    if (!best) continue;
    const { c, ang } = best;
    const ox = (bx0 + bx1) / 2, oy = (by0 + by1) / 2;
    const X = X0.clone().multiplyScalar(Math.cos(ang)).addScaledVector(Y0, Math.sin(ang));
    const Y = new Vector3().crossVectors(Nrm, X).normalize();
    const center = origin.clone().addScaledVector(X0, c.x).addScaledVector(Y0, c.y);
    const to3 = (p: Vector2) => center.clone().addScaledVector(X, p.x - ox).addScaledVector(Y, p.y - oy);
    const clean = (ring: Vector2[]) => {
      const r = ring.slice();
      if (r.length > 1 && r[0].distanceTo(r[r.length - 1]) < 1e-6) r.pop();
      return r;
    };
    return { glyphs: pts.map((g) => ({ outer: clean(g.shape).map(to3), holes: g.holes.map((hh) => clean(hh).map(to3)) })), X, Y };
  }
  return null;
}

/**
 * Triangulate the cap with the text cut out and add the engraved pockets (walls + floors), keeping a
 * closed, consistently wound surface.
 */
function engraveLabel(capLoop: number[], posOf: (i: number) => Vector3, label: PlacedLabel, O: Vector3, depth: number, firstIndex: number, outPos: number[], tris: number[]) {
  const { X, Y } = label;
  const down = O.clone().negate();
  // 2-D copies for triangulation get a deterministic sub-micron offset per vertex: the triangulator
  // silently drops exactly collinear points when the polygon has holes, which would open the mesh.
  const to2id = (i: number) => {
    const p = allPos(i);
    const j1 = (((i * 9301 + 49297) % 233280) / 233280 - 0.5) * 2e-5;
    const j2 = (((i * 4093 + 7919) % 104729) / 104729 - 0.5) * 2e-5;
    return new Vector2(p.dot(X) + j1, p.dot(Y) + j2);
  };
  const vid = (p: Vector3) => {
    const k = firstIndex + outPos.length / 3;
    outPos.push(p.x, p.y, p.z);
    return k;
  };
  const allPos = (i: number) => (i >= firstIndex ? new Vector3(outPos[3 * (i - firstIndex)], outPos[3 * (i - firstIndex) + 1], outPos[3 * (i - firstIndex) + 2]) : posOf(i));
  /**
   * Horizontal faces (cap, islands, pocket floors) all face outward = down = X × Y, so a triangle must
   * be counter-clockwise in the (X, Y) frame. Decided from 2-D signed area, robust for slivers.
   */
  const flat = (a: number, b: number, c: number) => {
    const pa = to2id(a), pb = to2id(b), pc = to2id(c);
    const area = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    if (area >= 0) tris.push(a, b, c);
    else tris.push(a, c, b);
  };
  void down;
  const rings = label.glyphs.map((g) => ({
    outer: { bot: g.outer.map(vid), top: g.outer.map((p) => vid(p.clone().addScaledVector(O, depth))) },
    holes: g.holes.map((h) => ({ bot: h.map(vid), top: h.map((p) => vid(p.clone().addScaledVector(O, depth))) })),
  }));
  // cap (bottom face) with glyph outlines as holes
  const contour = capLoop.map(to2id);
  const holes2 = rings.map((r) => r.outer.bot.map(to2id));
  const ids = [...capLoop, ...rings.flatMap((r) => r.outer.bot)];
  for (const [a, b, c] of ShapeUtils.triangulateShape(contour, holes2)) flat(ids[a], ids[b], ids[c]);
  for (const r of rings) {
    // islands inside letters (e.g. the middle of "O") stay at cap level
    for (const h of r.holes) for (const [a, b, c] of ShapeUtils.triangulateShape(h.bot.map(to2id), [])) flat(h.bot[a], h.bot[b], h.bot[c]);
    // pocket floor
    const floorIds = [...r.outer.top, ...r.holes.flatMap((h) => h.top)];
    for (const [a, b, c] of ShapeUtils.triangulateShape(r.outer.top.map(to2id), r.holes.map((h) => h.top.map(to2id)))) flat(floorIds[a], floorIds[b], floorIds[c]);
    // Walls: normals point into the pocket (inside letter outlines, outside island outlines).
    // Triangle (bot k, bot k+1, top k+1) has the edge's left-hand normal in the (X, Y) frame.
    const wall = (ring: { bot: number[]; top: number[] }, cavityInside: boolean) => {
      const ccw = ShapeUtils.area(ring.bot.map(to2id)) > 0;
      const leftIsCavity = ccw === cavityInside;
      for (let k = 0; k < ring.bot.length; k++) {
        const k2 = (k + 1) % ring.bot.length;
        if (leftIsCavity) tris.push(ring.bot[k], ring.bot[k2], ring.top[k2], ring.bot[k], ring.top[k2], ring.top[k]);
        else tris.push(ring.bot[k], ring.top[k2], ring.bot[k2], ring.bot[k], ring.top[k], ring.top[k2]);
      }
    };
    wall(r.outer, true);
    for (const h of r.holes) wall(h, false);
  }
}
