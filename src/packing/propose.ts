import { expandUnits, volumeOf } from '../domain/geometry';
import { createVehicle, VEHICLE_PRESETS } from '../domain/presets';
import type { CargoUnit, Plan, Vehicle, ViolationKind } from '../domain/types';
import { usableHeight } from '../rules/geometry';
import { evaluatePlan } from '../state/evaluate';
import { withPacking } from './apply';
import { capacityKg, usableOrientations } from './construct';
import { optimise } from './optimise';

/** Time budget of each verification run, ms. */
const VERIFY_MS = 40;
/** Most optimiser verification runs per proposal (keeps the call well under a few seconds). */
const MAX_VERIFICATIONS = 24;
const MAX_VEHICLES = 12;
/** Limits that must hold for a fleet to count as carrying the load legally. */
const LEGAL_KINDS: ReadonlySet<ViolationKind> = new Set(['axle-max', 'axle-min', 'gross', 'payload', 'bridge', 'floor-load']);

/**
 * Preset ids of the fewest vehicles that carry every unit legally (temperature-controlled goods
 * need a reefer), verified with short optimiser runs. Units that fit no preset are ignored. Tries
 * homogeneous fleets of increasing size (smallest preset first), then downsizes the last vehicle.
 */
export function proposeVehicles(plan: Plan): string[] {
  const presets = VEHICLE_PRESETS.map((p) => createVehicle(p.id, `proposal-${p.id}`));
  const fits = (u: CargoUnit, v: Vehicle) => (u.spec.temp === 'ambient' || v.tempControlled) && usableOrientations(u, v, plan).length > 0;
  const units = expandUnits(plan).filter((u) => presets.some((v) => fits(u, v)));
  if (!units.length) return [];
  const lineIds = new Set(units.map((u) => u.lineId));
  const lines = plan.lines.filter((l) => lineIds.has(l.id));
  const totalKg = units.reduce((s, u) => s + u.spec.weightKg, 0);
  const totalVolume = units.reduce((s, u) => s + volumeOf(u.spec.dims), 0);
  let runs = 0;
  const verify = (ids: readonly string[]): boolean => {
    runs++;
    const vehicles = ids.map((id, i) => createVehicle(id, `proposal-${i + 1}`));
    const trial: Plan = { ...plan, lines, vehicles, placements: {} };
    const vehicleIds = vehicles.map((v) => v.id);
    const r = optimise({ plan: trial, vehicleIds, keepExisting: false, seed: plan.settings.seed, timeBudgetMs: VERIFY_MS });
    if (r.unplaced.length) return false;
    const applied = withPacking(trial, vehicleIds, r.placements, r.zones, r.sliders, []);
    return !evaluatePlan(applied).violations.some((v) => v.hard || LEGAL_KINDS.has(v.kind));
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
