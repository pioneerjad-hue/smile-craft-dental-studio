import { BoxGeometry, BufferGeometry, Matrix4, Ray, SphereGeometry, Vector3 } from 'three';
import { DoubleSide } from 'three';
import { v3 } from '../core/transform';
import type { Attachment, ToothFrame } from '../core/types';
import type { ToothBody } from './contacts';

/**
 * Attachment solid placed on the buccal crown surface, in the tooth's initial (scan) coordinates.
 * Local axes: X = mesial, Y = occlusal, Z = surface normal (buccal). The base is embedded 0.3 mm
 * into the enamel so the attachment fuses with the crown when printed.
 */
export function attachmentGeometry(att: Attachment, frame: ToothFrame, body: ToothBody): BufferGeometry {
  const M = v3(frame.mesial), O = v3(frame.occlusal), B = v3(frame.buccal);
  const target = v3(frame.centroid).addScaledVector(O, att.offsetOcclusalMm).addScaledVector(M, att.offsetMesialMm);
  const origin = target.clone().addScaledVector(B, 15);
  const hit = body.bvh.raycastFirst(new Ray(origin, B.clone().negate()), DoubleSide);
  let surface: Vector3;
  let normal = B.clone();
  if (hit) {
    surface = hit.point.clone();
    if (hit.face) {
      const n = hit.face.normal.clone();
      if (n.dot(B) < 0) n.negate();
      // Blend with the buccal axis to keep the attachment upright on curved surfaces.
      normal = n.multiplyScalar(0.6).add(B.clone().multiplyScalar(0.4)).normalize();
    }
  } else {
    surface = target.clone().addScaledVector(B, frame.crownHeightMm * 0.35);
  }
  const X = M.clone().addScaledVector(normal, -M.dot(normal)).normalize();
  const Y = new Vector3().crossVectors(normal, X).normalize();
  if (Y.dot(O) < 0) Y.negate();
  const Z = normal;

  const [w, h, t] = att.size;
  const embed = 0.3;
  let g: BufferGeometry;
  if (att.type === 'ellipsoid') {
    g = new SphereGeometry(0.5, 20, 12);
    g.scale(w, h, 2 * (t + embed));
  } else {
    g = new BoxGeometry(w, h, t + embed, 1, 1, 1);
    g.translate(0, 0, (t + embed) / 2 - embed);
    if (att.type === 'beveledGingival' || att.type === 'beveledOcclusal') {
      // Taper the outer face so the thickness goes to ~0.2 mm at the beveled edge.
      const pos = g.getAttribute('position');
      const thinSide = att.type === 'beveledGingival' ? -1 : 1;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) > 0 && Math.sign(pos.getY(i)) === thinSide) pos.setZ(i, 0.2);
      }
      pos.needsUpdate = true;
    }
  }
  const basis = new Matrix4().makeBasis(X, Y, Z).setPosition(surface);
  g.applyMatrix4(basis);
  g.computeVertexNormals();
  return g.index ? g.toNonIndexed() : g;
}
