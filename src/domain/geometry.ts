import type { CargoUnit, Dims, Id, ItemSpec, Orientation, Placement, Plan, TankCompartment, Vec3, Vehicle } from './types';

type Axis = keyof Dims;

/**
 * The 6 axis-aligned orientations: which item-local dimension lies along cargo x, y and z.
 * 0/1 keep the item upright (h vertical); 2..5 lay it on a side or end.
 */
export const ORIENTATION_AXES: readonly (readonly [Axis, Axis, Axis])[] = [
  ['l', 'w', 'h'],
  ['w', 'l', 'h'],
  ['l', 'h', 'w'],
  ['h', 'l', 'w'],
  ['w', 'h', 'l'],
  ['h', 'w', 'l'],
];

export const ORIENTATION_LABELS = ['Upright', 'Upright, turned 90°', 'On its side', 'On its side, turned 90°', 'On its end', 'On its end, turned 90°'];

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** Extent of an item along cargo x/y/z for an orientation. */
export function orientedSize(dims: Dims, orient: Orientation): Vec3 {
  const [ax, ay, az] = ORIENTATION_AXES[orient];
  return { x: dims[ax], y: dims[ay], z: dims[az] };
}

/** Orientations permitted by the item's rotation rule, upright requirement and shape. */
export function allowedOrientations(spec: ItemSpec): Orientation[] {
  if (spec.rotation === 'none' || spec.packaging === 'bulk-liquid') return [0];
  const uprightOnly = spec.rotation === 'yaw' || spec.keepUpright || spec.shape === 'cylinder-upright';
  return uprightOnly ? [0, 1] : [0, 1, 2, 3, 4, 5];
}

/** Maps an item-local offset (x along l, y along w, z along h) into cargo axes for an orientation. */
export function orientedOffset(offset: Vec3, orient: Orientation): Vec3 {
  const local: Record<Axis, number> = { l: offset.x, w: offset.y, h: offset.z };
  const [ax, ay, az] = ORIENTATION_AXES[orient];
  return { x: local[ax], y: local[ay], z: local[az] };
}

export function placementBox(p: Pick<Placement, 'pos' | 'orient'>, spec: ItemSpec): Box {
  const s = orientedSize(spec.dims, p.orient);
  return { min: { ...p.pos }, max: { x: p.pos.x + s.x, y: p.pos.y + s.y, z: p.pos.z + s.z } };
}

export function boxCenter(b: Box): Vec3 {
  return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
}

/** Centre of gravity of a placed unit in cargo coordinates (geometric centre + oriented COG offset). */
export function placementCog(p: Pick<Placement, 'pos' | 'orient'>, spec: ItemSpec): Vec3 {
  const c = boxCenter(placementBox(p, spec));
  const o = orientedOffset(spec.cogOffset, p.orient);
  return { x: c.x + o.x, y: c.y + o.y, z: c.z + o.z };
}

/** True when the boxes overlap by more than `tol` along every axis. */
export function boxesOverlap(a: Box, b: Box, tol = 0): boolean {
  return (
    Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x) > tol &&
    Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y) > tol &&
    Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z) > tol
  );
}

/** Overlap area of the two boxes' footprints (x-y plane), m². */
export function footprintOverlap(a: Box, b: Box): number {
  const dx = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const dy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

export const unitIdOf = (lineId: Id, index: number): Id => `${lineId}#${index}`;

export function lineIdOfUnit(unitId: Id): Id {
  const i = unitId.lastIndexOf('#');
  return i < 0 ? unitId : unitId.slice(0, i);
}

/** Bulk liquid fills ride in tanker compartments instead of standing on the floor. */
export const isBulkLiquid = (spec: ItemSpec): boolean => spec.packaging === 'bulk-liquid';

export function compartmentOf(v: Vehicle, compartmentId: Id | undefined): TankCompartment | undefined {
  return compartmentId === undefined ? undefined : v.tank?.compartments.find((c) => c.id === compartmentId);
}

/** Fill of a compartment by a bulk unit, 0..1 of its brim capacity. */
export function compartmentFill(spec: ItemSpec, c: TankCompartment): number {
  return c.capacityL > 0 ? (spec.liquid?.volumeL ?? 0) / c.capacityL : 0;
}

/**
 * Centre of gravity of a bulk fill: middle of the compartment along x, tank centreline across, and the
 * liquid's centroid height (fill-proportional, ignoring the tank's curved cross-section).
 */
export function bulkCog(v: Vehicle, c: TankCompartment, spec: ItemSpec): Vec3 {
  const fill = Math.min(1, compartmentFill(spec, c));
  return { x: (c.fromX + c.toX) / 2, y: v.cargo.w / 2, z: (fill * v.cargo.h) / 2 };
}

const unitCache = new WeakMap<Plan, CargoUnit[]>();

/** Physical units of a plan, ordered by stop sequence, then line order. Memoised per plan object. */
export function expandUnits(plan: Plan): CargoUnit[] {
  const cached = unitCache.get(plan);
  if (cached) return cached;
  const seqByStop = new Map(plan.stops.map((s) => [s.id, s.sequence]));
  const units: CargoUnit[] = [];
  for (const line of plan.lines) {
    const stopSeq = seqByStop.get(line.stopId) ?? Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < line.quantity; i++) {
      units.push({ id: unitIdOf(line.id, i), lineId: line.id, index: i, spec: line.spec, stopId: line.stopId, stopSeq, priority: line.priority });
    }
  }
  units.sort((a, b) => a.stopSeq - b.stopSeq);
  unitCache.set(plan, units);
  return units;
}

export const volumeOf = (d: Dims): number => d.l * d.w * d.h;

/** EU loading metres of a footprint: floor length it occupies in a 2.4 m wide trailer. */
export const loadingMetres = (footprintM2: number): number => footprintM2 / 2.4;
