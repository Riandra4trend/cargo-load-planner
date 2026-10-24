import { expandUnits, isBulk, volumeOf } from '../domain/geometry';
import { materialDef, needsPressureTank } from '../domain/materials';
import { createVehicle, VEHICLE_PRESETS } from '../domain/presets';
import type { CargoUnit, Plan, Region, Vehicle, ViolationKind } from '../domain/types';
import { maxLegalFill } from '../physics';
import { litresOf, maxFillL, stateOf } from '../rules/bulk';
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

/** A proposal for one group of units, and whether it was verified to carry them all legally. */
interface Proposal {
  ids: string[];
  legal: boolean;
}

/**
 * Preset ids of the fewest vehicles that carry every unit legally, verified with short optimiser
 * runs: floor vehicles for packaged units (temperature-controlled goods need a reefer), tankers
 * for bulk liquid fills (food needs a food-grade tank, chilled food an insulated one, LPG a pressure
 * tank) and dump trucks for dry bulk. Units that fit no preset are ignored.
 *
 * Candidates come from the regions of the plan's vehicles plus ISO containers ('INTL'); a group
 * that those presets cannot carry legally (or a plan without regional vehicles) uses every preset.
 */
export function proposeVehicles(plan: Plan): string[] {
  const all = expandUnits(plan);
  const liquids = all.filter((u) => isBulk(u.spec) && stateOf(u.spec) === 'liquid');
  const solids = all.filter((u) => isBulk(u.spec) && stateOf(u.spec) === 'solid');
  const pressure = liquids.filter((u) => needsPressureTank(u.spec.material?.materialId ?? ''));
  const food = liquids.filter((u) => u.spec.isFood && !pressure.includes(u));
  const other = liquids.filter((u) => !u.spec.isFood && !pressure.includes(u));

  const everyPreset = VEHICLE_PRESETS.map((info) => createVehicle(info.id, `proposal-${info.id}`));
  const regions = new Set<Region>(plan.vehicles.map((v) => v.region).filter((r) => r !== 'custom'));
  const regional = regions.size ? everyPreset.filter((v) => v.region === 'INTL' || regions.has(v.region)) : everyPreset;
  const pick = (propose: (presets: readonly Vehicle[]) => Proposal): string[] => {
    const local = propose(regional);
    if (local.legal || regional === everyPreset) return local.ids;
    const global = propose(everyPreset);
    return global.legal || !local.ids.length ? global.ids : local.ids;
  };

  return [
    ...pick((presets) => proposeFloorFleet(plan, presets, all.filter((u) => !isBulk(u.spec)))),
    ...pick((presets) => proposeTankers(plan, presets, pressure, (v) => v.bulk!.pressurised)),
    ...pick((presets) => proposeTankers(plan, presets, food, (v) => v.bulk!.foodGrade && !v.bulk!.pressurised && (food.every((u) => u.spec.temp === 'ambient') || v.bulk!.insulated))),
    // Fuels, oils and chemicals never go into a food-grade tank; plain water may.
    ...pick((presets) =>
      proposeTankers(plan, presets, other, (v) => !v.bulk!.pressurised && !(v.bulk!.foodGrade && other.some((u) => !!u.spec.hazmat || ['fuel', 'oil', 'chemical'].includes(materialDef(u.spec.material?.materialId ?? '')?.category ?? '')))),
    ),
    ...solids.flatMap((u) => pick((presets) => proposeDumpTruck(presets, u))),
  ];
}

/**
 * Dump truck for one dry bulk fill (one fill per body): the smallest preset whose body carries the
 * fill legally at the body centre (physics maxLegalFill on an empty truck), else the largest.
 */
function proposeDumpTruck(presets: readonly Vehicle[], u: CargoUnit): Proposal {
  const material = u.spec.material!;
  const trucks = presets.filter((v) => v.bulk?.kind === 'tipper').sort((a, b) => totalCapacity(a) - totalCapacity(b));
  if (!trucks.length) return { ids: [], legal: false };
  const legal = trucks.find((v) => maxLegalFill(v, [], v.bulk!.compartments[0], material).litres >= litresOf(u.spec) - 1e-6);
  return { ids: [(legal ?? trucks[trucks.length - 1]).presetId], legal: !!legal };
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
function proposeTankers(plan: Plan, candidates: readonly Vehicle[], fills: readonly CargoUnit[], eligible: (v: Vehicle) => boolean): Proposal {
  if (!fills.length) return { ids: [], legal: true };
  const presets = candidates
    .filter((v) => v.bulk?.kind === 'tank' && eligible(v))
    .filter((v) => fills.every((u) => v.bulk!.compartments.some((c) => litresOf(u.spec) <= maxFillL(u.spec, c.capacityL) + 1e-6)))
    .sort((a, b) => totalCapacity(a) - totalCapacity(b));
  if (!presets.length) return { ids: [], legal: false };
  const litres = fills.reduce((sum, u) => sum + litresOf(u.spec), 0);
  const lowerBound = (v: Vehicle) => Math.max(1, Math.ceil(fills.length / v.bulk!.compartments.length - 1e-9), Math.ceil(litres / (totalCapacity(v) * 0.97) - 1e-9));
  let placedOnly: string[] | null = null;
  let runs = 0;
  for (let k = Math.min(...presets.map(lowerBound)); k <= MAX_VEHICLES && runs < MAX_VERIFICATIONS; k++) {
    for (const v of presets) {
      if (lowerBound(v) > k || runs >= MAX_VERIFICATIONS) continue;
      runs++;
      const fleet = Array.from({ length: k }, () => v.presetId);
      const check = verifyFleet(plan, fills, fleet);
      if (check.legal) return { ids: fleet, legal: true };
      if (check.placed) placedOnly ??= fleet;
    }
    if (placedOnly) return { ids: placedOnly, legal: false };
  }
  const largest = presets[presets.length - 1];
  return { ids: placedOnly ?? Array.from({ length: Math.min(MAX_VEHICLES, lowerBound(largest)) }, () => largest.presetId), legal: false };
}

const totalCapacity = (v: Vehicle): number => v.bulk!.compartments.reduce((sum, c) => sum + c.capacityL, 0);

/**
 * Fewest floor vehicles for packaged units. Tries homogeneous fleets of increasing size (smallest
 * preset first), then downsizes the last vehicle. Not legal when some unit fits none of `candidates`.
 */
function proposeFloorFleet(plan: Plan, candidates: readonly Vehicle[], packaged: readonly CargoUnit[]): Proposal {
  const presets = candidates.filter((v) => !v.bulk);
  const fits = (u: CargoUnit, v: Vehicle) => (u.spec.temp === 'ambient' || v.tempControlled) && usableOrientations(u, v, plan).length > 0;
  const units = packaged.filter((u) => presets.some((v) => fits(u, v)));
  const complete = units.length === packaged.length;
  if (!units.length) return { ids: [], legal: complete };
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
  if (!homogeneous.length) return { ids: [], legal: false };

  for (let k = Math.min(...homogeneous.map(lowerBound)); k <= MAX_VEHICLES && runs < MAX_VERIFICATIONS; k++) {
    for (const v of homogeneous) {
      if (lowerBound(v) > k || runs >= MAX_VERIFICATIONS) continue;
      const fleet = Array.from({ length: k }, () => v.presetId);
      if (!verify(fleet)) continue;
      for (const smaller of presets.filter((w) => capacityKg(w) < capacityKg(v)).sort((a, b) => capacityKg(a) - capacityKg(b))) {
        if (runs >= MAX_VERIFICATIONS) break;
        const mixed = [...fleet.slice(0, -1), smaller.presetId];
        if (verify(mixed)) return { ids: mixed, legal: complete };
      }
      return { ids: fleet, legal: complete };
    }
  }
  const largest = homogeneous[homogeneous.length - 1];
  return { ids: Array.from({ length: Math.min(MAX_VEHICLES, lowerBound(largest)) }, () => largest.presetId), legal: false };
}
