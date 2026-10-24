import { Quaternion, Vector3 } from 'three';
import { ORIENTATION_AXES, type Box } from '../domain/geometry';
import type { Dims, ItemSpec, Orientation } from '../domain/types';
import { boxToThree, THREE_AXIS, writeThree, type CargoAxis } from './coords';

/** Visible pieces of one cargo unit: an optional pallet base and the goods (box or cylinder). */
export interface UnitPart {
  kind: 'pallet' | 'box' | 'cylinder';
  /** Cargo-space bounds of the piece. */
  box: Box;
  /** Pallet: the cargo axis the item's height runs along. Cylinder: the cylinder axis. Box: unused (2). */
  axis: CargoAxis;
}

/** Goods sit slightly inside the pallet footprint. */
const GOODS_INSET = 0.012;
/** Pallet bases are drawn in a darker shade of the unit colour. */
export const PALLET_SHADE = 0.55;

const axisOf = (orient: Orientation, local: keyof Dims): CargoAxis => ORIENTATION_AXES[orient].indexOf(local) as CargoAxis;

const KEYS = ['x', 'y', 'z'] as const;

/** Splits a placed unit into its pallet base and goods. `box` is the unit's cargo-space bounding box. */
export function unitParts(spec: ItemSpec, orient: Orientation, box: Box): UnitPart[] {
  const parts: UnitPart[] = [];
  const up = axisOf(orient, 'h');
  const k = KEYS[up];
  const extent = box.max[k] - box.min[k];
  let goods = box;
  if (spec.palletHeight > 0 && spec.palletHeight < extent - 0.01) {
    const pallet: Box = { min: { ...box.min }, max: { ...box.max } };
    pallet.max[k] = box.min[k] + spec.palletHeight;
    parts.push({ kind: 'pallet', box: pallet, axis: up });
    goods = { min: { ...box.min }, max: { ...box.max } };
    goods.min[k] = pallet.max[k];
    for (const other of KEYS) {
      if (other === k) continue;
      const inset = Math.min(GOODS_INSET, (goods.max[other] - goods.min[other]) / 4);
      goods.min[other] += inset;
      goods.max[other] -= inset;
    }
  }
  if (spec.shape === 'box') parts.push({ kind: 'box', box: goods, axis: 2 });
  else parts.push({ kind: 'cylinder', box: goods, axis: axisOf(orient, spec.shape === 'cylinder-upright' ? 'h' : 'l') });
  return parts;
}

const Y_UP = new Vector3(0, 1, 0);
const AXIS_DIRS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const tmpSize = new Vector3();

/**
 * Transform that maps a unit primitive (centred, local Y = `axis`, unit size) onto a cargo box:
 * writes position, rotation and scale. Used for pallets (local Y = up through the deck) and cylinders.
 */
export function axisAlignedTransform(box: Box, axis: CargoAxis, position: Vector3, quaternion: Quaternion, scale: Vector3): void {
  boxToThree(box, position, tmpSize);
  const threeAxis = THREE_AXIS[axis];
  quaternion.setFromUnitVectors(Y_UP, AXIS_DIRS[threeAxis]);
  if (threeAxis === 1) scale.copy(tmpSize);
  else if (threeAxis === 0) scale.set(tmpSize.y, tmpSize.x, tmpSize.z);
  else scale.set(tmpSize.x, tmpSize.z, tmpSize.y);
}

const RING_SEGMENTS = 24;

/** Number of line segments `writePartEdges` emits for a part. */
export const edgeSegmentCount = (part: UnitPart): number => (part.kind === 'cylinder' ? RING_SEGMENTS * 2 : 12);

const BOX_EDGES = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];

/**
 * Writes a part's outline (box edges, or the two end rings of a cylinder) as line-segment points into
 * `buffer` (three.js coordinates) starting at float `offset`; returns the next free offset.
 */
export function writePartEdges(buffer: Float32Array, offset: number, part: UnitPart): number {
  const { min, max } = part.box;
  if (part.kind !== 'cylinder') {
    for (const c of BOX_EDGES) {
      writeThree(buffer, offset, c === 1 || c === 2 || c === 5 || c === 6 ? max.x : min.x, c === 2 || c === 3 || c === 6 || c === 7 ? max.y : min.y, c >= 4 ? max.z : min.z);
      offset += 3;
    }
    return offset;
  }
  const k = KEYS[part.axis];
  const [a, b] = KEYS.filter((key) => key !== k);
  const ca = (min[a] + max[a]) / 2;
  const cb = (min[b] + max[b]) / 2;
  const ra = (max[a] - min[a]) / 2;
  const rb = (max[b] - min[b]) / 2;
  const p = { x: 0, y: 0, z: 0 };
  for (const end of [min[k], max[k]]) {
    for (let i = 0; i < RING_SEGMENTS; i++) {
      for (const s of [i, i + 1]) {
        const t = (s / RING_SEGMENTS) * Math.PI * 2;
        p[k] = end;
        p[a] = ca + Math.cos(t) * ra;
        p[b] = cb + Math.sin(t) * rb;
        writeThree(buffer, offset, p.x, p.y, p.z);
        offset += 3;
      }
    }
  }
  return offset;
}
