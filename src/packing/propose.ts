import { expandUnits, isBulkLiquid, volumeOf } from '../domain/geometry';
import { liquidDef, needsPressureTank } from '../domain/liquids';
import { createVehicle, VEHICLE_PRESETS } from '../domain/presets';
import type { CargoUnit, Plan, Vehicle, ViolationKind } from '../domain/types';
import { litresOf, maxFillL } from '../rules/tank';
import { usableHeight } from '../rules/geometry';
import { evaluatePlan } from '../state/evaluate';
import { withPacking } from './apply';
import { capacityKg, usableOrientations } from './construct';
import { optimise } from './optimise';

/** Each verification run: an iteration cap (machine-independent result) and a safety time limit, ms. */
const VERIFY_ITERATIONS = 20;
const VERIFY_MS = 1000;
/** Most optimiser verification runs per proposal (keeps the call well under a few seconds). */
const MAX_VERIFICATIONS = 24;
const MAX_VEHICLES = 12;
/** Limits that must hold for a fleet to count as carrying the load legally. */
const LEGAL_KINDS: ReadonlySet<ViolationKind> = new Set(['axle-max', 'axle-min', 'gross', 'payload', 'bridge', 'floor-load']);

/**
 * Preset ids of the fewest vehicles that carry every unit legally, verified with short optimiser
 * runs: floor vehicles for packaged units (temperature-controlled goods need a reefer) and tankers
 * for bulk liquid fills (food needs a food-grade tank, chilled food an insulated one, LPG a pressure
 * tank). Units that fit no preset are ignored.
 */
export function proposeVehicles(plan: Plan): string[] {
  const all = expandUnits(plan);
  const bulk = all.filter((u) => isBulkLiquid(u.spec));
  const pressure = bulk.filter((u) => needsPressureTank(u.spec.liquid?.liquidId ?? ''));
  const food = bulk.filter((u) => u.spec.isFood && !pressure.includes(u));
  const other = bulk.filter((u) => !u.spec.isFood && !pressure.includes(u));
  return [
    ...proposeFloorFleet(
      plan,
      all.filter((u) => !isBulkLiquid(u.spec)),
    ),
    ...proposeTankers(plan, pressure, (v) => v.tank!.pressurised),
    ...proposeTankers(plan, food, (v) => v.tank!.foodGrade && !v.tank!.pressurised && (food.every((u) => u.spec.temp === 'ambient') || v.tank!.insulated)),
    // Fuels, oils and chemicals never go into a food-grade tank; plain water may.
    ...proposeTankers(plan, other, (v) => !v.tank!.pressurised && !(v.tank!.foodGrade && other.some((u) => !!u.spec.hazmat || ['fuel', 'oil', 'chemical'].includes(liquidDef(u.spec.liquid?.liquidId ?? '')?.category ?? '')))),
  ];
}

/** Optimises `units` alone on a fleet of presets and reports whether everything is placed legally. */
function verifyFleet(plan: Plan, units: readonly CargoUnit[], ids: readonly string[]): { placed: boolean; legal: boolean } {
  const lineIds = new Set(units.map((u) => u.lineId));
  const vehicles = ids.map((id, i) => createVehicle(id, `proposal-${i + 1}`));
  const trial: Plan = { ...plan, lines: plan.lines.filter((l) => lineIds.has(l.id)), vehicles, placements: {} };
  const vehicleIds = vehicles.map((v) => v.id);
  const r = optimise({ plan: trial, vehicleIds, keepExisting: false, seed: plan.settings.seed, timeBudgetMs: VERIFY_MS, maxIterations: VERIFY_ITERATIONS });
  if (r.unplaced.length) return { placed: false, legal: false };
  const applied = withPacking(trial, vehicleIds, r.placements, r.zones, r.sliders, []);
  return { placed: true, legal: !evaluatePlan(applied).violations.some((v) => v.hard || LEGAL_KINDS.has(v.kind)) };
}

/** Fewest, smallest tankers of one kind (`eligible`) holding every fill, by volume and compartment count. */
function proposeTankers(plan: Plan, fills: readonly CargoUnit[], eligible: (v: Vehicle) => boolean): string[] {
  if (!fills.length) return [];
  const presets = VEHICLE_PRESETS.map((p) => createVehicle(p.id, `proposal-${p.id}`))
    .filter((v) => v.tank && eligible(v))
    .filter((v) => fills.every((u) => v.tank!.compartments.some((c) => litresOf(u.spec) <= maxFillL(u.spec, c.capacityL) + 1e-6)))
    .sort((a, b) => totalCapacity(a) - totalCapacity(b));
  if (!presets.length) return [];
  const litres = fills.reduce((sum, u) => sum + litresOf(u.spec), 0);
  const lowerBound = (v: Vehicle) => Math.max(1, Math.ceil(fills.length / v.tank!.compartments.length - 1e-9), Math.ceil(litres / (totalCapacity(v) * 0.97) - 1e-9));
  let placedOnly: string[] | null = null;
  let runs = 0;
  for (let k = Math.min(...presets.map(lowerBound)); k <= MAX_VEHICLES && runs < MAX_VERIFICATIONS; k++) {
    for (const v of presets) {
      if (lowerBound(v) > k || runs >= MAX_VERIFICATIONS) continue;
      runs++;
      const fleet = Array.from({ length: k }, () => v.presetId);
      const check = verifyFleet(plan, fills, fleet);
      if (check.legal) return fleet;
      if (check.placed) placedOnly ??= fleet;
    }
    if (placedOnly) return placedOnly;
  }
  const largest = presets[presets.length - 1];
  return placedOnly ?? Array.from({ length: Math.min(MAX_VEHICLES, lowerBound(largest)) }, () => largest.presetId);
}

const totalCapacity = (v: Vehicle): number => v.tank!.compartments.reduce((sum, c) => sum + c.capacityL, 0);

/**
 * Fewest floor vehicles for packaged units. Tries homogeneous fleets of increasing size (smallest
 * preset first), then downsizes the last vehicle.
 */
function proposeFloorFleet(plan: Plan, candidates: readonly CargoUnit[]): string[] {
  const presets = VEHICLE_PRESETS.map((p) => createVehicle(p.id, `proposal-${p.id}`)).filter((v) => !v.tank);
  const fits = (u: CargoUnit, v: Vehicle) => (u.spec.temp === 'ambient' || v.tempControlled) && usableOrientations(u, v, plan).length > 0;
  const units = candidates.filter((u) => presets.some((v) => fits(u, v)));
  if (!units.length) return [];
  const totalKg = units.reduce((s, u) => s + u.spec.weightKg, 0);
  const totalVolume = units.reduce((s, u) => s + volumeOf(u.spec.dims), 0);
  let runs = 0;
  const verify = (ids: readonly string[]): boolean => {
    runs++;
    return verifyFleet(plan, units, ids).legal;
  };

  const lowerBound = (v: Vehicle) =>
    Math.max(1, Math.ceil(totalKg / capacityKg(v) - 1e-9), Math.ceil(totalVolume / (v.cargo.l * v.cargo.w * usableHeight(v, plan.settings)) - 1e-9));
  const homogeneous = presets.filter((v) => units.every((u) => fits(u, v))).sort((a, b) => capacityKg(a) - capacityKg(b));
  if (!homogeneous.length) return [];

  for (let k = Math.min(...homogeneous.map(lowerBound)); k <= MAX_VEHICLES && runs < MAX_VERIFICATIONS; k++) {
    for (const v of homogeneous) {
      if (lowerBound(v) > k || runs >= MAX_VERIFICATIONS) continue;
      const fleet = Array.from({ length: k }, () => v.presetId);
      if (!verify(fleet)) continue;
      for (const smaller of presets.filter((w) => capacityKg(w) < capacityKg(v)).sort((a, b) => capacityKg(a) - capacityKg(b))) {
        if (runs >= MAX_VERIFICATIONS) break;
        const mixed = [...fleet.slice(0, -1), smaller.presetId];
        if (verify(mixed)) return mixed;
      }
      return fleet;
    }
  }
  const largest = homogeneous[homogeneous.length - 1];
  return Array.from({ length: Math.min(MAX_VEHICLES, lowerBound(largest)) }, () => largest.presetId);
}
