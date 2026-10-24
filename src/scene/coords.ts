import { Vector3 } from 'three';
import type { Box } from '../domain/geometry';
import type { Vec3 } from '../domain/types';

/**
 * The ONLY place where cargo coordinates meet three.js coordinates.
 *
 * Cargo space: x = length from the front wall toward the rear doors, y = width from the left wall,
 * z = up from the cargo floor. three.js (Y-up): X = cargo x, Y = cargo z, Z = -cargo y.
 * The cargo floor is at three Y = 0, so the ground under a vehicle sits at Y = -vehicle.deckHeight.
 */

/** Cargo axis index (0 = x, 1 = y, 2 = z). */
export type CargoAxis = 0 | 1 | 2;

/** three.js position tuple of a cargo point. */
export const toThree = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];

/** Writes the three.js position of a cargo point into `out`. */
export function setThree(out: Vector3, x: number, y: number, z: number): Vector3 {
  return out.set(x, z, -y);
}

/** Writes the three.js position of a cargo point into a flat buffer at `offset` (3 floats). */
export function writeThree(buffer: Float32Array, offset: number, x: number, y: number, z: number): void {
  buffer[offset] = x;
  buffer[offset + 1] = z;
  buffer[offset + 2] = -y;
}

export const vecToThree = (p: Vec3, out: Vector3 = new Vector3()): Vector3 => out.set(p.x, p.z, -p.y);

/** Cargo point of a three.js position. */
export const threeToCargo = (v: Vector3): Vec3 => ({ x: v.x, y: -v.z, z: v.y });

/** Writes the three.js centre and (positive) size of a cargo-space box. */
export function boxToThree(b: Box, centre: Vector3, size: Vector3): void {
  centre.set((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, -(b.min.y + b.max.y) / 2);
  size.set(b.max.x - b.min.x, b.max.z - b.min.z, b.max.y - b.min.y);
}

/** three.js centre and size tuples of a cargo box given by its min / max corners (for JSX props). */
export function boxProps(min: readonly [number, number, number], max: readonly [number, number, number]): { position: [number, number, number]; scale: [number, number, number] } {
  return {
    position: [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2, -(min[1] + max[1]) / 2],
    scale: [Math.abs(max[0] - min[0]), Math.abs(max[2] - min[2]), Math.abs(max[1] - min[1])],
  };
}

/** three.js axis index (0 = X, 1 = Y, 2 = Z) of a cargo axis. */
export const THREE_AXIS: readonly [0, 2, 1] = [0, 2, 1];

/** Euler rotation that turns a three.js Y-aligned primitive (cylinder, plane normal Y) onto a cargo axis. */
export function yToCargoAxisRotation(axis: CargoAxis): [number, number, number] {
  if (axis === 0) return [0, 0, -Math.PI / 2];
  if (axis === 1) return [Math.PI / 2, 0, 0];
  return [0, 0, 0];
}
