import { PACKAGING_PRESETS } from '../../data/packaging';
import { allowedOrientations, isBulkLiquid, loadingMetres, orientedSize, volumeOf } from '../../domain/geometry';
import { liquidWeightKg, maxFillPct, needsPressureTank } from '../../domain/liquids';
import { createVehicle, VEHICLE_PRESETS } from '../../domain/presets';
import type { CargoLine, ItemSpec, Plan, PlanSettings, Vehicle } from '../../domain/types';
import { formatLitres } from '../../domain/units';

const EPS = 1e-6;

export interface VehicleFit {
  id: string;
  name: string;
  fits: boolean;
  /** Why it does not fit (or a caveat when it does, e.g. no temperature control). */
  reason?: string;
  /** Tankers: the compartments large enough for the fill ("C1, C3"). */
  detail?: string;
}

/** Usable cargo height: interior height minus reefer airflow gap and ceiling clearance. */
export const usableHeight = (v: Vehicle, settings: PlanSettings): number => v.cargo.h - v.airflowTopGap - settings.ceilingClearance;

/** Only rear access: the unit must pass through the rear door aperture (side/top access bypass it). */
const doorLimited = (v: Vehicle): boolean => v.walls && !v.access.includes('side') && !v.access.includes('top');

/** Brim capacity of a packaged liquid's container, litres (undefined when unknown). */
export function containerCapacityL(spec: ItemSpec): number | undefined {
  return spec.liquid?.containerCapacityL ?? PACKAGING_PRESETS[spec.packaging].capacityL;
}

/** Container / packaging weight of a liquid unit: gross weight minus the liquid, kg. */
export function liquidTareKg(spec: ItemSpec): number {
  return spec.liquid ? Math.max(0, spec.weightKg - liquidWeightKg(spec.liquid)) : 0;
}

/** Whether a bulk fill can ride in a tanker: a free-standing compartment check (size × max fill, food grade, insulation, payload). */
function fitTanker(spec: ItemSpec, v: Vehicle, settings: PlanSettings): VehicleFit {
  const base = { id: v.id, name: v.name };
  if (!v.tank) return { ...base, fits: false, reason: 'not a tanker' };
  const volume = spec.liquid?.volumeL ?? 0;
  const pressure = needsPressureTank(spec.liquid?.liquidId ?? '');
  if (pressure && !v.tank.pressurised) return { ...base, fits: false, reason: 'needs a pressurised tank' };
  if (!pressure && v.tank.pressurised) return { ...base, fits: false, reason: 'pressure tank: liquefied gas only' };
  const pct = maxFillPct(spec.liquid?.liquidId ?? '') / 100;
  const large = v.tank.compartments.filter((c) => volume <= c.capacityL * pct + EPS);
  if (!large.length) {
    const biggest = Math.max(0, ...v.tank.compartments.map((c) => c.capacityL));
    return { ...base, fits: false, reason: `no compartment large enough (max ${formatLitres(biggest * pct, settings.units, 0)} per fill)` };
  }
  if (spec.isFood && !v.tank.foodGrade) return { ...base, fits: false, reason: 'needs a food-grade tank' };
  if (spec.temp !== 'ambient' && !v.tank.insulated) return { ...base, fits: false, reason: 'needs an insulated tank' };
  if (spec.weightKg > v.payloadKg) return { ...base, fits: false, reason: 'heavier than the payload' };
  return { ...base, fits: true, detail: large.map((c) => c.label).join(', ') };
}

/**
 * Whether one unit can ride in a vehicle. Bulk fills: some tanker compartment holds it. Other units:
 * fits the cargo space (and the door, for rear-only vehicles) in some allowed orientation.
 */
export function fitVehicle(spec: ItemSpec, v: Vehicle, settings: PlanSettings): VehicleFit {
  if (isBulkLiquid(spec)) return fitTanker(spec, v, settings);
  const base = { id: v.id, name: v.name };
  if (v.tank) return { ...base, fits: false, reason: 'tankers carry bulk fills only' };
  const maxH = usableHeight(v, settings);
  let space = false;
  let door = false;
  for (const o of allowedOrientations(spec)) {
    const s = orientedSize(spec.dims, o);
    if (s.x > v.cargo.l + EPS || s.y > v.cargo.w + EPS || s.z > maxH + EPS) continue;
    space = true;
    if (!doorLimited(v) || (s.y <= v.door.w + EPS && s.z <= v.door.h + EPS)) {
      door = true;
      break;
    }
  }
  if (!space) return { ...base, fits: false, reason: 'too large for the cargo space' };
  if (!door) return { ...base, fits: false, reason: 'does not pass the door' };
  if (spec.weightKg > v.payloadKg) return { ...base, fits: false, reason: 'heavier than the payload' };
  if (spec.temp !== 'ambient' && !v.tempControlled) return { ...base, fits: true, reason: 'no temperature control' };
  return { ...base, fits: true };
}

let presetVehicles: Vehicle[] | null = null;
/** One vehicle per preset (built once). */
export function presetVehicleList(): Vehicle[] {
  presetVehicles ??= VEHICLE_PRESETS.map((p) => ({ ...createVehicle(p.id, `preset:${p.id}`), name: p.name }));
  return presetVehicles;
}

export interface Derived {
  volume: number;
  density: number;
  footprint: number;
  ldm: number;
  /** Plan vehicles of the relevant kind (tankers for bulk fills, the others otherwise). */
  planFits: VehicleFit[];
  presetFits: VehicleFit[];
}

export function deriveItem(spec: ItemSpec, plan: Plan): Derived {
  const bulk = isBulkLiquid(spec);
  const relevant = (v: Vehicle) => !!v.tank === bulk;
  const volume = bulk ? (spec.liquid?.volumeL ?? 0) / 1000 : volumeOf(spec.dims);
  const footprint = bulk ? 0 : spec.dims.l * spec.dims.w;
  return {
    volume,
    density: volume > 0 ? spec.weightKg / volume : Number.NaN,
    footprint,
    ldm: loadingMetres(footprint),
    planFits: plan.vehicles.filter(relevant).map((v) => fitVehicle(spec, v, plan.settings)),
    presetFits: presetVehicleList()
      .filter(relevant)
      .map((v) => fitVehicle(spec, v, plan.settings)),
  };
}

export type LineDraft = Omit<CargoLine, 'id'>;
export type DraftField =
  | 'name'
  | 'dims'
  | 'weight'
  | 'quantity'
  | 'palletHeight'
  | 'cog'
  | 'unNumber'
  | 'hazClass'
  | 'stop'
  | 'timeWindow'
  | 'maxStackLayers'
  | 'volume'
  | 'density'
  | 'liquidName';

export interface DraftIssues {
  errors: Partial<Record<DraftField, string>>;
  /** Errors not bound to a single field (e.g. fits no vehicle). */
  blocking: string[];
  warnings: string[];
}

export const UN_PATTERN = /^UN\d{4}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Validation of an item-editor draft against the plan's vehicles, the vehicle presets and settings. */
export function checkDraft(draft: LineDraft, plan: Plan, derived: Derived): DraftIssues {
  const { spec } = draft;
  const sys = plan.settings.units;
  const bulk = isBulkLiquid(spec);
  const errors: DraftIssues['errors'] = {};
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (!spec.name.trim()) errors.name = 'Name is required';
  if (!bulk) {
    if (!(spec.dims.l > 0 && spec.dims.w > 0 && spec.dims.h > 0)) errors.dims = 'All dimensions must be positive';
    else if (spec.palletHeight < 0 || spec.palletHeight >= spec.dims.h) errors.palletHeight = 'Pallet height must be below the total height';
    if (!(Number.isInteger(spec.maxStackLayers) && spec.maxStackLayers >= 1)) errors.maxStackLayers = 'At least 1 layer';
    const c = spec.cogOffset;
    if (Math.abs(c.x) > spec.dims.l / 2 + EPS || Math.abs(c.y) > spec.dims.w / 2 + EPS || Math.abs(c.z) > spec.dims.h / 2 + EPS) {
      errors.cog = 'COG offset must stay inside the unit (± half of each dimension)';
    }
  }
  if (!(spec.weightKg > 0)) errors.weight = 'Weight must be positive';
  if (!(Number.isInteger(draft.quantity) && draft.quantity >= 1)) errors.quantity = 'Quantity must be a whole number ≥ 1';
  if (spec.hazmat) {
    if (!UN_PATTERN.test(spec.hazmat.unNumber)) errors.unNumber = 'Format UN0000';
    if (!spec.hazmat.hazClass) errors.hazClass = 'Choose a class';
  }
  if (!plan.stops.some((s) => s.id === draft.stopId)) errors.stop = 'Choose a delivery stop';
  if (draft.timeWindow) {
    const { from, to } = draft.timeWindow;
    if (!TIME_PATTERN.test(from) || !TIME_PATTERN.test(to)) errors.timeWindow = 'Use HH:MM';
    else if (from >= to) errors.timeWindow = 'Window must end after it starts';
  }

  const liquid = spec.liquid;
  if (liquid) {
    if (!liquid.name.trim()) errors.liquidName = 'Name the liquid';
    if (!(liquid.densityKgPerL > 0)) errors.density = 'Density must be positive';
    if (!(liquid.volumeL > 0)) errors.volume = 'Volume must be positive';
    const cap = bulk ? undefined : containerCapacityL(spec);
    if (cap && liquid.volumeL > 0) {
      const pct = maxFillPct(liquid.liquidId);
      if (liquid.volumeL > cap + EPS) errors.volume = `Exceeds the container capacity of ${formatLitres(cap, sys, 0)}`;
      else if (liquid.volumeL > (cap * pct) / 100 + EPS) warnings.push(`Above the ${pct} % max fill (${formatLitres((cap * pct) / 100, sys, 1)}): leave room for thermal expansion`);
    }
  }

  if (!errors.dims && !errors.weight && !errors.volume) {
    const planOk = derived.planFits.some((f) => f.fits);
    const presetOk = derived.presetFits.some((f) => f.fits);
    if (bulk) {
      if (!planOk && !presetOk) blocking.push('Fits no tanker: no compartment of a plan vehicle or tanker preset can hold this fill');
      else if (!planOk && !derived.planFits.length) warnings.push('Needs a tanker: add a tanker vehicle that can carry it');
      else if (!planOk) {
        for (const reason of new Set(derived.planFits.map((f) => f.reason ?? ''))) {
          warnings.push(reason.startsWith('needs') ? capitalise(reason) : `No tanker in this plan can carry it: ${reason}`);
        }
      }
    } else {
      if (!planOk && !presetOk) blocking.push('Fits no vehicle or door: no plan vehicle and no preset can carry it');
      else if (!planOk) warnings.push('Fits no vehicle in this plan; add a vehicle that can carry it');
      if (Number.isFinite(derived.density) && derived.density < 10) warnings.push('Implausibly low density (< 10 kg/m³): check dimensions and weight');
      if (Number.isFinite(derived.density) && derived.density > 8000) warnings.push('Implausibly high density (> 8,000 kg/m³): check dimensions and weight');
      if (spec.weightKg > plan.settings.forkliftCapacityKg) warnings.push('Heavier than the forklift capacity: needs special lifting equipment');
    }
  }
  return { errors, blocking, warnings };
}

export const hasErrors = (issues: DraftIssues): boolean => issues.blocking.length > 0 || Object.keys(issues.errors).length > 0;
