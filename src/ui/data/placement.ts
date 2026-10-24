import type { Id, ItemSpec, Placement } from '../../domain/types';
import { findPlacementFor } from '../../packing';
import { useStore } from '../../state/store';
import { vehicleSuits } from './itemChecks';

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

/**
 * Vehicle to place a unit of this spec on: the active vehicle when it is the right kind (tankers take
 * liquid fills, dump trucks dry bulk, the others packaged units), else the first vehicle of the right kind.
 */
export function targetVehicleId(spec: ItemSpec): Id | undefined {
  const { plan, ui } = useStore.getState();
  const matching = plan.vehicles.filter((v) => vehicleSuits(spec, v));
  return (matching.find((v) => v.id === ui.activeVehicleId) ?? matching[0])?.id;
}
