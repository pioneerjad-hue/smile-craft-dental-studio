/**
 * Makes triangle winding consistent inside every connected piece of a mesh and points each piece
 * outward. Exported dental models sometimes contain shells (often single teeth) whose triangles face
 * inward, or mixed winding where pieces were stitched; smooth vertex normals then cancel or point into
 * the model and render black. Modifies `index` in place and returns how many triangles were flipped.
 */
export function orientWinding(positions: ArrayLike<number>, index: Uint32Array): number {
  const nf = index.length / 3;
  // edge → faces (only manifold edges propagate orientation)
  const edgeFaces = new Map<number, number[]>();
  const nv = positions.length / 3;
  const key = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const e = key(index[3 * f + k], index[3 * f + ((k + 1) % 3)]);
      const l = edgeFaces.get(e);
      if (l) l.push(f);
      else edgeFaces.set(e, [f]);
    }
  }
  const comp = new Int32Array(nf).fill(-1);
  const flip = (f: number) => {
    const t = index[3 * f + 1];
    index[3 * f + 1] = index[3 * f + 2];
    index[3 * f + 2] = t;
  };
  // does face g traverse edge (a→b) in the same direction as face f does?
  const sameDir = (g: number, a: number, b: number) => {
    for (let k = 0; k < 3; k++) if (index[3 * g + k] === a && index[3 * g + ((k + 1) % 3)] === b) return true;
    return false;
  };
  let flipped = 0;
  let nc = 0;
  const comps: number[][] = [];
  for (let s = 0; s < nf; s++) {
    if (comp[s] >= 0) continue;
    const faces: number[] = [s];
    comp[s] = nc;
    for (let qi = 0; qi < faces.length; qi++) {
      const f = faces[qi];
      for (let k = 0; k < 3; k++) {
        const a = index[3 * f + k], b = index[3 * f + ((k + 1) % 3)];
        const l = edgeFaces.get(key(a, b))!;
        if (l.length !== 2) continue;
        const g = l[0] === f ? l[1] : l[0];
        if (comp[g] >= 0) continue;
        comp[g] = nc;
        if (sameDir(g, a, b)) (flip(g), flipped++);
        faces.push(g);
      }
    }
    comps.push(faces);
    nc++;
  }
  // point every piece outward: signed volume about the piece's centroid must be positive
  for (const faces of comps) {
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (const f of faces) for (let k = 0; k < 3; k++) {
      const v = index[3 * f + k];
      cx += positions[3 * v]; cy += positions[3 * v + 1]; cz += positions[3 * v + 2]; n++;
    }
    cx /= n; cy /= n; cz /= n;
    let vol = 0;
    for (const f of faces) {
      const a = 3 * index[3 * f], b = 3 * index[3 * f + 1], c = 3 * index[3 * f + 2];
      const ax = positions[a] - cx, ay = positions[a + 1] - cy, az = positions[a + 2] - cz;
      const bx = positions[b] - cx, by = positions[b + 1] - cy, bz = positions[b + 2] - cz;
      const qx = positions[c] - cx, qy = positions[c + 1] - cy, qz = positions[c + 2] - cz;
      vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    }
    if (vol < 0) for (const f of faces) (flip(f), flipped++);
  }
  return flipped;
}
