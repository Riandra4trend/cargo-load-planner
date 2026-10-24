/** Per-plan memoised lookups shared by checkPlan, validateMove and the fix suggestions. */
import { expandUnits, isBulk } from '../domain/geometry';
import type { CargoUnit, Id, Plan, Vehicle } from '../domain/types';
import { Arrangement, makeSolid } from './arrangement';

export interface PlanIndex {
  units: Map<Id, CargoUnit>;
  labels: Map<Id, string>;
  vehicles: Map<Id, Vehicle>;
}

const indexCache = new WeakMap<Plan, PlanIndex>();
const arrangementCache = new WeakMap<Plan, Map<string, Arrangement>>();

/** Display label of every unit: the item name, plus "#n" when its line holds several units. */
export function planIndex(plan: Plan): PlanIndex {
  const cached = indexCache.get(plan);
  if (cached) return cached;
  const qty = new Map(plan.lines.map((l) => [l.id, l.quantity]));
  const units = new Map<Id, CargoUnit>();
  const labels = new Map<Id, string>();
  for (const u of expandUnits(plan)) {
    units.set(u.id, u);
    labels.set(u.id, (qty.get(u.lineId) ?? 1) > 1 ? `${u.spec.name} #${u.index + 1}` : u.spec.name);
  }
  const index: PlanIndex = { units, labels, vehicles: new Map(plan.vehicles.map((v) => [v.id, v])) };
  indexCache.set(plan, index);
  return index;
}

/**
 * Arrangement of the floor units placed in a vehicle, optionally without one unit (memoised per
 * plan). Bulk liquid fills have no box and take no part in geometric checks.
 */
export function vehicleArrangement(plan: Plan, vehicle: Vehicle, excludeId: Id | null = null): Arrangement {
  let byKey = arrangementCache.get(plan);
  if (!byKey) {
    byKey = new Map();
    arrangementCache.set(plan, byKey);
  }
  const key = `${vehicle.id}\u0000${excludeId ?? ''}`;
  const cached = byKey.get(key);
  if (cached) return cached;
  const { units, labels } = planIndex(plan);
  const solids = [];
  for (const p of Object.values(plan.placements)) {
    if (p.vehicleId !== vehicle.id || p.unitId === excludeId) continue;
    const u = units.get(p.unitId);
    if (u && !isBulk(u.spec)) solids.push(makeSolid(u, labels.get(u.id) ?? u.spec.name, p));
  }
  const arr = Arrangement.build(vehicle, plan.settings, solids);
  byKey.set(key, arr);
  return arr;
}
