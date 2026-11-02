import { describe, expect, it } from 'vitest';
import { BoxGeometry } from 'three';
import { makeDemoArch } from '../src/geometry/demo';
import { classifyModel, ATTACHMENT, GUM, TOOTH } from '../src/geometry/classify';

describe('stage model colouring', () => {
  it('finds attachment shells, teeth and gingiva', () => {
    const demo = makeDemoArch('lower');
    const g = demo.geometry;
    const base = new Float32Array(g.getAttribute('position').array as ArrayLike<number>);
    const idx = Array.from(g.index!.array as ArrayLike<number>);
    // two attachment shells (3 × 2 × 1 mm boxes) on the buccal of 43 and 33
    const pos = Array.from(base);
    for (const id of [43, 33]) {
      const t = demo.teeth.find((x) => x.id === id)!;
      const box = new BoxGeometry(3, 2, 1).translate(t.x, t.y + 3.5, t.top - 3);
      const off = pos.length / 3;
      pos.push(...Array.from(box.getAttribute("position").array as ArrayLike<number>));
      idx.push(...Array.from(box.index!.array as ArrayLike<number>, (i) => i + off));
    }
    const flags = classifyModel('lower', new Float32Array(pos), new Uint32Array(idx));
    const n0 = base.length / 3;
    // all box vertices are attachments
    for (let i = n0; i < flags.length; i++) expect(flags[i]).toBe(ATTACHMENT);
    // crown tips are teeth, border vertices are gingiva
    const near = (x: number, y: number, z: number) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < n0; i++) {
        const d = (base[3 * i] - x) ** 2 + (base[3 * i + 1] - y) ** 2 + (base[3 * i + 2] - z) ** 2;
        if (d < bd) (bd = d), (best = i);
      }
      return best;
    };
    let teeth = 0;
    for (const t of demo.teeth) if (flags[near(t.x, t.y, t.top)] === TOOTH) teeth++;
    expect(teeth).toBe(demo.teeth.length);
    expect(flags.slice(0, n0).filter((f) => f === GUM).length).toBeGreaterThan(n0 * 0.3);
  }, 60000);
});

describe('teeth exported as separate shells with roots', () => {
  it('keeps long crown+root shells as teeth and the arch shell as gingiva', () => {
    // gingiva: the demo arch; teeth: 28 mm tall boxes (crown + root) as separate shells
    const demo = makeDemoArch('lower');
    const pos = Array.from(demo.geometry.getAttribute('position').array as ArrayLike<number>);
    const idx = Array.from(demo.geometry.index!.array as ArrayLike<number>);
    const n0 = pos.length / 3;
    for (const t of demo.teeth) {
      const box = new BoxGeometry(6, 7, 28).translate(t.x, t.y, t.top - 14);
      const off = pos.length / 3;
      pos.push(...Array.from(box.getAttribute('position').array as ArrayLike<number>));
      idx.push(...Array.from(box.index!.array as ArrayLike<number>, (i) => i + off));
    }
    const flags = classifyModel('lower', new Float32Array(pos), new Uint32Array(idx));
    expect(flags.slice(0, n0).every((f) => f === GUM)).toBe(true);
    expect(flags.slice(n0).every((f) => f === TOOTH)).toBe(true);
  });
});
