import { Matrix4, Quaternion } from 'three';
import type { Arch } from './fdi';
import { movementMatrix, v3 } from './transform';
import type { Movement, ToothFrame } from './types';
import { MOVEMENT_KEYS, zeroMovement } from './types';

/** Arch and stage from an exported file name, e.g. "Case_Upper_Stage_12.stl", "lower final.stl". */
export function parseExportName(name: string): { arch: Arch | null; stage: number | null } {
  const n = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  let arch: Arch | null = null;
  if (/(upper|maxil|superior|\bsup\b|oben|\bu\b|_u_|^u_|_u$|mascella|arcata ?sup)/.test(n)) arch = 'upper';
  else if (/(lower|mandib|inferior|\binf\b|unten|\bl\b|_l_|^l_|_l$|mandibola|arcata ?inf)/.test(n)) arch = 'lower';
  let stage: number | null = null;
  if (/(final|target|end|finish|setup)/.test(n)) stage = Number.POSITIVE_INFINITY;
  else if (/(initial|start|pre|original|before|malocclusion|iniziale)/.test(n)) stage = 0;
  const m = n.match(/(?:stage|step|aligner|tappa|fase|st|s|t)[ _#-]*(\d{1,3})(?!\d)/) ?? n.match(/(?:^|[^\d])(\d{1,3})(?!\d)(?!.*\d)/);
  if (m && stage === null) stage = Number(m[1]);
  return { arch, stage };
}

export interface ToothDifference {
  id: number;
  /** Distance between the crown centres of the two final positions (mm). */
  crownMm: number;
  /** Angle between the two final orientations (degrees). */
  angleDeg: number;
  delta: Movement;
}

/** How far a plan's final tooth positions are from a reference setup, tooth by tooth. */
export function compareToReference(frames: Record<number, ToothFrame>, plan: Record<number, Movement>, reference: Record<number, Movement>): { teeth: ToothDifference[]; meanCrownMm: number; meanAngleDeg: number; maxCrownMm: number } {
  const teeth: ToothDifference[] = [];
  for (const [k, ref] of Object.entries(reference)) {
    const id = +k;
    const f = frames[id];
    if (!f) continue;
    const mine = plan[id] ?? zeroMovement();
    const A = movementMatrix(f, mine);
    const B = movementMatrix(f, ref);
    const c = v3(f.centroid);
    const crownMm = c.clone().applyMatrix4(A).distanceTo(c.clone().applyMatrix4(B));
    const qa = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(A));
    const qb = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(B));
    const angleDeg = (qa.angleTo(qb) * 180) / Math.PI;
    const delta = Object.fromEntries(MOVEMENT_KEYS.map((key) => [key, mine[key] - ref[key]])) as unknown as Movement;
    teeth.push({ id, crownMm, angleDeg, delta });
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    teeth: teeth.sort((a, b) => b.crownMm - a.crownMm),
    meanCrownMm: mean(teeth.map((t) => t.crownMm)),
    meanAngleDeg: mean(teeth.map((t) => t.angleDeg)),
    maxCrownMm: Math.max(0, ...teeth.map((t) => t.crownMm)),
  };
}
