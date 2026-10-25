import { unitIdOf } from '../../domain/geometry';
import type { Id, ItemSpec, Placement, Plan } from '../../domain/types';
import { findPlacementFor } from '../../packing';
import { validateMove } from '../../rules';
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

/**
 * Placements for the units of a freshly added line on one vehicle, without moving other cargo (pure).
 * Unit #0 takes `first` (re-targeted to that unit and vehicle) when it passes every hard constraint,
 * otherwise the best free spot; the rest follow one by one on the evolving plan. Bulk units get
 * compartments. Stops at the first unit that finds no legal spot (the units are identical).
 */
export function placeNewLine(plan: Plan, lineId: Id, quantity: number, vehicleId: Id, first?: Placement): Placement[] {
  let current = plan;
  const found: Placement[] = [];
  for (let i = 0; i < quantity; i++) {
    const unitId = unitIdOf(lineId, i);
    const candidate = i === 0 && first ? { ...first, unitId, vehicleId } : null;
    const p = candidate && validateMove(current, candidate).ok ? candidate : findPlacementFor(current, unitId, vehicleId);
    if (!p) break;
    found.push(p);
    current = { ...current, placements: { ...current.placements, [unitId]: p } };
  }
  return found;
}

export interface AddCargoResult {
  lineId: Id;
  /** Unit ids placed on the vehicle, in unit order. */
  placed: Id[];
  /** Unit ids added but left unplaced (no legal spot). */
  unplaced: Id[];
}

/**
 * Adds `quantity` units of a spec for a stop and loads them onto a vehicle as ONE undo step
 * (store.addLineAndPlace). Units that find no legal spot stay on the line as unplaced. Used by the
 * cargo palette and by 3D drops (`opts.first` = the candidate placement for unit #0 at the drop point).
 */
export function addCargoToVehicle(spec: ItemSpec, quantity: number, stopId: Id, vehicleId: Id, opts: { first?: Placement; contents?: string } = {}): AddCargoResult {
  const count = Math.max(1, Math.round(quantity));
  let placements: Placement[] = [];
  const lineId = useStore.getState().addLineAndPlace(
    { spec: structuredClone(spec), quantity: count, stopId, priority: 'normal', contents: opts.contents },
    (plan, id) => (placements = placeNewLine(plan, id, count, vehicleId, opts.first)),
    'Add cargo',
  );
  const placed = new Set(placements.map((p) => p.unitId));
  const all = Array.from({ length: count }, (_, i) => unitIdOf(lineId, i));
  return { lineId, placed: all.filter((id) => placed.has(id)), unplaced: all.filter((id) => !placed.has(id)) };
}
