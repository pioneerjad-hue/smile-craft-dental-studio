import { describe, expect, it } from 'vitest';
import { BoxGeometry } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { orientWinding } from '../src/geometry/winding';

function box() {
  const g = mergeVertices(new BoxGeometry(4, 5, 6).deleteAttribute('normal').deleteAttribute('uv'));
  return { pos: g.getAttribute('position').array as Float32Array, idx: new Uint32Array(g.index!.array) };
}

describe('orientWinding', () => {
  it('turns an inside-out shell outward', () => {
    const { pos, idx } = box();
    const ref = idx.slice();
    for (let f = 0; f < idx.length; f += 3) [idx[f + 1], idx[f + 2]] = [idx[f + 2], idx[f + 1]];
    expect(orientWinding(pos, idx)).toBe(idx.length / 3);
    expect(Array.from(idx)).toEqual(Array.from(ref));
  });
  it('repairs mixed winding', () => {
    const { pos, idx } = box();
    const ref = idx.slice();
    for (const f of [0, 3, 7]) [idx[3 * f + 1], idx[3 * f + 2]] = [idx[3 * f + 2], idx[3 * f + 1]];
    orientWinding(pos, idx);
    expect(Array.from(idx)).toEqual(Array.from(ref));
  });
  it('leaves a correct shell untouched', () => {
    const { pos, idx } = box();
    expect(orientWinding(pos, idx)).toBe(0);
  });
});
