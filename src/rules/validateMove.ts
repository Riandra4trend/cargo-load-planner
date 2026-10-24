import { compartmentOf, isBulkLiquid, placementBox, placementCog } from '../domain/geometry';
import type { CargoUnit, Placement, Plan, Vehicle } from '../domain/types';
import { planIndex, vehicleArrangement } from './context';
import { fillIssueReason, fillIssues, fillName, fillsOf, pairIssue, pairIssueReason, withCompartment, type FillRef } from './tank';

export interface MoveCheck {
  ok: boolean;
  /** Human-readable reasons when !ok, e.g. "Overlaps Press die set, crated". */
  reasons: string[];
}

/**
 * Hard-constraint check for placing one unit at `candidate`, against the other units in that
 * vehicle (bounds, ceiling, door, overlap, support, stacking incl. load and layers on its new
 * supporters, fragile, rotation, temperature, hazmat). Also rejects moving a unit that currently
 * carries other units. Bulk liquid fills are checked against the tanker compartments instead,
 * with the store's swap semantics when the target compartment is occupied.
 */
export function validateMove(plan: Plan, candidate: Placement): MoveCheck {
  const { units, vehicles } = planIndex(plan);
  const unit = units.get(candidate.unitId);
  const vehicle = vehicles.get(candidate.vehicleId);
  if (!unit) return { ok: false, reasons: ['Unknown unit'] };
  if (!vehicle) return { ok: false, reasons: ['Unknown vehicle'] };
  if (isBulkLiquid(unit.spec)) return validateFill(plan, unit, vehicle, candidate);
  if (vehicle.tank) return { ok: false, reasons: ['A tanker only carries bulk liquid'] };
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

function validateFill(plan: Plan, unit: CargoUnit, vehicle: Vehicle, candidate: Placement): MoveCheck {
  const c = compartmentOf(vehicle, candidate.compartmentId);
  if (!vehicle.tank || !c) return { ok: false, reasons: ['Bulk liquid goes into a tanker compartment'] };
  const { units, labels } = planIndex(plan);
  const sys = plan.settings.units;
  const fills = fillsOf(vehicle, withCompartment(plan.placements, unit.id, vehicle, c), units, labels);
  const reasons: string[] = [];
  const mover = fills.find((f) => f.id === unit.id)!;
  for (const issue of fillIssues(vehicle, c, unit.spec)) reasons.push(fillIssueReason(issue, unit.spec, c, sys));
  for (const other of fills) {
    if (other === mover) continue;
    const issue = pairIssue(vehicle, plan.settings, mover, other);
    if (issue) reasons.push(pairIssueReason(issue, mover, other));
  }
  // A fill swapped back into the mover's old compartment must be legal there too.
  const prev = plan.placements[unit.id];
  const occupantId = Object.values(plan.placements).find((p) => p.unitId !== unit.id && p.vehicleId === vehicle.id && p.compartmentId === c.id)?.unitId;
  const swapped: FillRef | undefined = prev?.vehicleId === vehicle.id ? fills.find((f) => f.id === occupantId) : undefined;
  if (swapped) {
    const after = (text: string) => `After the swap, ${swapped.label}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    const issues = fillIssues(vehicle, swapped.c, swapped.spec);
    for (const issue of issues) {
      reasons.push(issue.type === 'overfill' ? `${fillName(swapped, sys)} would not fit ${swapped.c.label} after the swap` : after(fillIssueReason(issue, swapped.spec, swapped.c, sys)));
    }
    for (const other of fills) {
      if (other === swapped || other === mover) continue;
      const issue = pairIssue(vehicle, plan.settings, swapped, other);
      if (issue) reasons.push(after(pairIssueReason(issue, swapped, other)));
    }
  }
  return { ok: reasons.length === 0, reasons };
}
