/**
 * FDI (ISO 3950) tooth numbering helpers.
 * Quadrants: 1 = upper right, 2 = upper left, 3 = lower left, 4 = lower right (patient's side).
 */
export type Arch = 'upper' | 'lower';

export type ToothType =
  | 'centralIncisor'
  | 'lateralIncisor'
  | 'canine'
  | 'firstPremolar'
  | 'secondPremolar'
  | 'firstMolar'
  | 'secondMolar'
  | 'thirdMolar';

export const TOOTH_TYPES: ToothType[] = [
  'centralIncisor',
  'lateralIncisor',
  'canine',
  'firstPremolar',
  'secondPremolar',
  'firstMolar',
  'secondMolar',
  'thirdMolar',
];

export const TOOTH_TYPE_LABEL: Record<ToothType, string> = {
  centralIncisor: 'Central incisor',
  lateralIncisor: 'Lateral incisor',
  canine: 'Canine',
  firstPremolar: 'First premolar',
  secondPremolar: 'Second premolar',
  firstMolar: 'First molar',
  secondMolar: 'Second molar',
  thirdMolar: 'Third molar',
};

/** Arch sequences ordered from the patient's right distal end to the left distal end. */
export const UPPER_SEQUENCE = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_SEQUENCE = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

export function isValidTooth(id: number): boolean {
  const q = Math.floor(id / 10);
  const n = id % 10;
  return Number.isInteger(id) && q >= 1 && q <= 4 && n >= 1 && n <= 8;
}

export function quadrant(id: number): number {
  return Math.floor(id / 10);
}

export function toothNumber(id: number): number {
  return id % 10;
}

export function archOf(id: number): Arch {
  return quadrant(id) <= 2 ? 'upper' : 'lower';
}

export function toothType(id: number): ToothType {
  return TOOTH_TYPES[toothNumber(id) - 1];
}

export function isPatientRight(id: number): boolean {
  const q = quadrant(id);
  return q === 1 || q === 4;
}

export function isAnterior(id: number): boolean {
  return toothNumber(id) <= 3;
}

export function sequence(arch: Arch): number[] {
  return arch === 'upper' ? UPPER_SEQUENCE : LOWER_SEQUENCE;
}

export function sequenceIndex(id: number): number {
  return sequence(archOf(id)).indexOf(id);
}

/** Step in the arch sequence that points mesially (towards the midline). */
export function mesialStep(id: number): 1 | -1 {
  return isPatientRight(id) ? 1 : -1;
}

/** Contralateral (mirror) tooth: 11 <-> 21, 36 <-> 46 ... */
export function contralateral(id: number): number {
  const q = quadrant(id);
  const mirror: Record<number, number> = { 1: 2, 2: 1, 3: 4, 4: 3 };
  return mirror[q] * 10 + toothNumber(id);
}

/** Short clinical label, e.g. "UR1" for 11, "LL6" for 36. */
export function shortLabel(id: number): string {
  const q = quadrant(id);
  const prefix = { 1: 'UR', 2: 'UL', 3: 'LL', 4: 'LR' }[q] ?? '?';
  return `${prefix}${toothNumber(id)}`;
}

export function toothName(id: number): string {
  const side = isPatientRight(id) ? 'right' : 'left';
  const arch = archOf(id) === 'upper' ? 'Upper' : 'Lower';
  return `${arch} ${side} ${TOOTH_TYPE_LABEL[toothType(id)].toLowerCase()}`;
}

/** Canonical contact key, ordered by arch sequence. */
export function contactKey(a: number, b: number): string {
  const [x, y] = sequenceIndex(a) <= sequenceIndex(b) ? [a, b] : [b, a];
  return `${x}-${y}`;
}

/**
 * Adjacent contacts within an arch among the present teeth (missing teeth are skipped,
 * so a contact is the next present neighbour in the sequence).
 */
export function adjacentPairs(arch: Arch, present: Iterable<number>): [number, number][] {
  const set = new Set(present);
  const ids = sequence(arch).filter((t) => set.has(t));
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < ids.length; i++) pairs.push([ids[i], ids[i + 1]]);
  return pairs;
}

/** Sort tooth ids in arch-sequence order (upper first). */
export function sortTeeth(ids: Iterable<number>): number[] {
  const order = [...UPPER_SEQUENCE, ...LOWER_SEQUENCE];
  return [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
