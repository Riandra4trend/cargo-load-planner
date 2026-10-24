import { placementBox, placementCog } from '../domain/geometry';
import type { Placement, Plan } from '../domain/types';
import { planIndex, vehicleArrangement } from './context';

export interface MoveCheck {
  ok: boolean;
  /** Human-readable reasons when !ok, e.g. "Overlaps Press die set, crated". */
  reasons: string[];
}

/**
 * Hard-constraint check for placing one unit at `candidate`, against the other units in that
 * vehicle (bounds, ceiling, door, overlap, support, stacking incl. load and layers on its new
 * supporters, fragile, rotation, temperature, hazmat). Also rejects moving a unit that currently
 * carries other units.
 */
export function validateMove(plan: Plan, candidate: Placement): MoveCheck {
  const { units, vehicles } = planIndex(plan);
  const unit = units.get(candidate.unitId);
  const vehicle = vehicles.get(candidate.vehicleId);
  if (!unit) return { ok: false, reasons: ['Unknown unit'] };
  if (!vehicle) return { ok: false, reasons: ['Unknown vehicle'] };
  const reasons: string[] = [];
  const current = plan.placements[unit.id];
  const currentVehicle = current ? vehicles.get(current.vehicleId) : undefined;
  if (currentVehicle) {
    const arr = vehicleArrangement(plan, currentVehicle);
    const i = arr.solids.findIndex((s) => s.id === unit.id);
    if (i >= 0 && arr.dependents[i].length > 0) reasons.push('Unstack the units on top first');
  }
  const arr = vehicleArrangement(plan, vehicle, unit.id);
  arr.check(unit, candidate.orient, placementBox(candidate, unit.spec), placementCog(candidate, unit.spec), (_kind, message) => {
    reasons.push(message());
    return false;
  });
  return { ok: reasons.length === 0, reasons };
}
