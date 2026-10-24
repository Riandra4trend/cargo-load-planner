import type { Id, Placement } from '../../domain/types';
import { findPlacementFor } from '../../packing';
import { useStore } from '../../state/store';

/**
 * Places units one after another on a vehicle without moving anything else (each search sees the
 * previously found positions), commits them as one undo step and returns how many were placed.
 */
export function placeOnVehicle(unitIds: Id[], vehicleId: Id): number {
  const { plan: committed, placeUnits } = useStore.getState();
  let plan = committed;
  const found: Placement[] = [];
  for (const unitId of unitIds) {
    const p = findPlacementFor(plan, unitId, vehicleId);
    if (!p) break;
    found.push(p);
    plan = { ...plan, placements: { ...plan.placements, [unitId]: p } };
  }
  if (found.length) placeUnits(found, found.length === 1 ? 'Place unit' : 'Place units');
  return found.length;
}

/** The active vehicle id, falling back to the first vehicle when the selection is stale. */
export function activeVehicleId(): Id | undefined {
  const { plan, ui } = useStore.getState();
  return plan.vehicles.find((v) => v.id === ui.activeVehicleId)?.id ?? plan.vehicles[0]?.id;
}
