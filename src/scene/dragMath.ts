import { expandUnits, footprintOverlap, placementBox, type Box } from '../domain/geometry';
import type { Id, Plan, Vec3, Vehicle } from '../domain/types';

/** Distance within which a dragged unit's edge snaps to a wall or a neighbour's edge, metres. */
export const EDGE_SNAP_M = 0.08;

/** Static data for one drag: the other units of the vehicle and the snapping settings. */
export interface DragContext {
  vehicle: Vehicle;
  /** Boxes of every other unit placed in the vehicle. */
  others: Box[];
  grid: number;
}

export function dragContext(plan: Plan, vehicleId: Id, unitId: Id): DragContext | null {
  const vehicle = plan.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return null;
  const others: Box[] = [];
  for (const u of expandUnits(plan)) {
    const p = plan.placements[u.id];
    if (u.id !== unitId && p?.vehicleId === vehicleId) others.push(placementBox(p, u.spec));
  }
  return { vehicle, others, grid: plan.settings.snapGrid };
}

/**
 * Snaps the minimum corner of a span [min, min + size] along one axis: walls and neighbour edges
 * within EDGE_SNAP_M win (closest first), otherwise the grid applies; the result is clamped to [0, limit].
 */
function snapAxis(min: number, size: number, limit: number, edges: readonly number[], grid: number): number {
  let best = Number.POSITIVE_INFINITY;
  let snapped = grid > 0 ? Math.round(min / grid) * grid : min;
  for (const e of edges) {
    const dMin = Math.abs(min - e);
    if (dMin < EDGE_SNAP_M && dMin < best) {
      best = dMin;
      snapped = e;
    }
    const dMax = Math.abs(min + size - e);
    if (dMax < EDGE_SNAP_M && dMax < best) {
      best = dMax;
      snapped = e - size;
    }
  }
  return Math.min(Math.max(snapped, 0), Math.max(0, limit - size));
}

/**
 * Candidate minimum corner for a unit of oriented `size` whose footprint centre follows the pointer:
 * snapped to the grid and neighbour edges, clamped to the cargo floor, and lifted onto the highest
 * unit under its footprint (dropping onto a unit stacks it).
 */
export function dragCandidate(ctx: DragContext, centre: { x: number; y: number }, size: Vec3): Vec3 {
  const { vehicle, others, grid } = ctx;
  const near = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > -0.5;
  const rawX = centre.x - size.x / 2;
  const rawY = centre.y - size.y / 2;
  const edgesX = [0, vehicle.cargo.l];
  const edgesY = [0, vehicle.cargo.w];
  for (const b of others) {
    if (near(rawY, rawY + size.y, b.min.y, b.max.y)) edgesX.push(b.min.x, b.max.x);
    if (near(rawX, rawX + size.x, b.min.x, b.max.x)) edgesY.push(b.min.y, b.max.y);
  }
  const x = snapAxis(rawX, size.x, vehicle.cargo.l, edgesX, grid);
  const y = snapAxis(rawY, size.y, vehicle.cargo.w, edgesY, grid);
  const footprint: Box = { min: { x, y, z: 0 }, max: { x: x + size.x, y: y + size.y, z: size.z } };
  let z = 0;
  for (const b of others) if (b.max.z > z && footprintOverlap(footprint, b) > 1e-4) z = b.max.z;
  return { x, y, z };
}
