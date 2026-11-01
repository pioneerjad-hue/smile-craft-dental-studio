import { ShapeUtils, Vector2, Vector3 } from 'three';
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
}

export interface ModelBase {
  /** New vertices (flat-plane copies of the border), indexed from `vertexOffset`. */
  positions: Float32Array;
  vertexOffset: number;
  /** Triangles referencing scan vertices (< vertexOffset) and new vertices (>= vertexOffset). */
  index: Uint32Array;
  borderLength: number;
  holesFilled: number;
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
function fillLoop(loop: number[], pos: (i: number) => Vector3, e1: Vector3, e2: Vector3, out: number[]) {
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
  // Cap: the flat loop a'→b' has the same direction as the border, so the same fill rule applies.
  fillLoop(outer.map((i) => flatIndex.get(i)!), posOf, e1, e2, tris);
  // Fill remaining holes in the scan.
  for (const hole of loops.slice(1)) fillLoop(hole, posOf, e1, e2, tris);
  return { positions, vertexOffset: N, index: new Uint32Array(tris), borderLength: outer.length, holesFilled: loops.length - 1 };
}
