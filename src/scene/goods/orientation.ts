import { Matrix4 } from 'three';
import { ORIENTATION_AXES } from '../../domain/geometry';
import type { Dims, Orientation, Vec3 } from '../../domain/types';

/**
 * Instance transforms for goods models. A model is built in the unrotated item frame (three.js axes:
 * X = l, Y = h, Z = -w, min corner at the origin). For each of the 6 orientations we use a PROPER
 * rotation (det +1, never a mirror): the axis permutation from ORIENTATION_AXES, with the cargo-y axis
 * negated when the permutation is odd, plus an offset so the rotated model fills the placement box.
 */

const AXIS_INDEX: Record<keyof Dims, number> = { l: 0, w: 1, h: 2 };

/** cargo (x, y, z) -> three (x, z, -y), as in scene/coords.ts. */
const CARGO_TO_THREE = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const THREE_TO_CARGO = CARGO_TO_THREE.clone().invert();

interface OrientationTransform {
  /** Rotation in three.js space. */
  rotation: Matrix4;
  /** Cargo axes along which the rotated model runs negative (needs +size offset). */
  negative: readonly [boolean, boolean, boolean];
  axes: readonly [keyof Dims, keyof Dims, keyof Dims];
}

const TRANSFORMS: OrientationTransform[] = ORIENTATION_AXES.map((axes) => {
  const perm = axes.map((a) => AXIS_INDEX[a]);
  const r = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  perm.forEach((p, i) => (r[i][p] = 1));
  const det = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  const flipY = det < 0;
  if (flipY) r[1][perm[1]] = -1;
  const cargo = new Matrix4().set(r[0][0], r[0][1], r[0][2], 0, r[1][0], r[1][1], r[1][2], 0, r[2][0], r[2][1], r[2][2], 0, 0, 0, 0, 1);
  const rotation = new Matrix4().multiplyMatrices(CARGO_TO_THREE, cargo).multiply(THREE_TO_CARGO);
  return { rotation, negative: [false, flipY, false], axes: [axes[0], axes[1], axes[2]] };
});

/** Rotation part (three.js space) of an orientation's instance transform. */
export const orientationRotation = (orient: Orientation): Matrix4 => TRANSFORMS[orient].rotation;

/**
 * Writes the three.js instance matrix that places a goods model (built for `dims`) in orientation
 * `orient` with its placement box minimum corner at cargo position `pos`. Allocation-free.
 */
export function goodsInstanceMatrix(orient: Orientation, dims: Dims, pos: Vec3, out: Matrix4): Matrix4 {
  const t = TRANSFORMS[orient];
  const tx = pos.x + (t.negative[0] ? dims[t.axes[0]] : 0);
  const ty = pos.y + (t.negative[1] ? dims[t.axes[1]] : 0);
  const tz = pos.z + (t.negative[2] ? dims[t.axes[2]] : 0);
  out.copy(t.rotation);
  out.elements[12] = tx;
  out.elements[13] = tz;
  out.elements[14] = -ty;
  return out;
}
