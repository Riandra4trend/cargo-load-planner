import { PACKAGING_PRESETS } from '../../data/packaging';
import { allowedOrientations, isBulk, lineIdOfUnit, loadingMetres, orientedSize, volumeOf } from '../../domain/geometry';
import { materialWeightKg, maxFillPct, needsPressureTank } from '../../domain/materials';
import { createVehicle, VEHICLE_PRESETS } from '../../domain/presets';
import type { BulkKind, CargoLine, Compartment, ItemSpec, MaterialContents, MaterialState, Plan, PlanSettings, Vehicle } from '../../domain/types';
import { formatMaterialVolume } from '../../domain/units';
import { maxLegalFill, type MassPoint } from '../../physics';
import { evaluatePlan } from '../../state/evaluate';

const EPS = 1e-6;

export interface VehicleFit {
  id: string;
  name: string;
  fits: boolean;
  /** Why it does not fit (or a caveat when it does, e.g. no temperature control). */
  reason?: string;
  /** Tankers: the compartments large enough for the fill ("C1, C3"); dump trucks: the legal maximum load. */
  detail?: string;
}

/** Usable cargo height: interior height minus reefer airflow gap and ceiling clearance. */
export const usableHeight = (v: Vehicle, settings: PlanSettings): number => v.cargo.h - v.airflowTopGap - settings.ceilingClearance;

/** Only rear access: the unit must pass through the rear door aperture (side/top access bypass it). */
const doorLimited = (v: Vehicle): boolean => v.walls && !v.access.includes('side') && !v.access.includes('top');

/** The bulk body a loose material rides in: liquids in tanks, dry bulk in tipper (dump) bodies. */
export const bulkKindFor = (state: MaterialState): BulkKind => (state === 'liquid' ? 'tank' : 'tipper');

/** Whether a vehicle is the right kind for a spec: bulk fills need a matching bulk body, packaged units a vehicle without one. */
export function vehicleSuits(spec: ItemSpec, v: Vehicle): boolean {
  if (!isBulk(spec)) return !v.bulk;
  return v.bulk?.kind === bulkKindFor(spec.material?.state ?? 'liquid');
}

/** Brim capacity of a packaged material's container, litres (undefined when unknown). */
export function containerCapacityL(spec: ItemSpec): number | undefined {
  return spec.material?.containerCapacityL ?? PACKAGING_PRESETS[spec.packaging].capacityL;
}

/** Container / packaging weight of a material unit: gross weight minus the material, kg. */
export function materialTareKg(spec: ItemSpec): number {
  return spec.material ? Math.max(0, spec.weightKg - materialWeightKg(spec.material)) : 0;
}

export interface LegalFill {
  litres: number;
  limitedBy: string;
  compartment: Compartment;
}

/** Largest legal single fill of a material on a vehicle (best compartment, on top of `others`), or null without a bulk body. */
export function bestLegalFill(v: Vehicle, material: Pick<MaterialContents, 'materialId' | 'state' | 'densityKgPerL'>, others: readonly MassPoint[] = []): LegalFill | null {
  let best: LegalFill | null = null;
  for (const c of v.bulk?.compartments ?? []) {
    const fill = maxLegalFill(v, others, c, material);
    if (!best || fill.litres > best.litres) best = { ...fill, compartment: c };
  }
  return best;
}

/** Splitting one over-limit fill into equal legal loads: n = ceil(volume / legal max) fills of volume / n. */
export function splitLegalLoads(volumeL: number, legalL: number): { count: number; volumeL: number } {
  const count = legalL > 0 ? Math.max(1, Math.ceil(volumeL / legalL - 1e-9)) : 1;
  return { count, volumeL: volumeL / count };
}

/** Tanker check for a liquid fill: pressure, compartment size × max fill, food grade, insulation and payload. */
function fitTank(spec: ItemSpec, m: MaterialContents, v: Vehicle, settings: PlanSettings): VehicleFit {
  const base = { id: v.id, name: v.name };
  const bulk = v.bulk!;
  const pressure = needsPressureTank(m.materialId);
  if (pressure && !bulk.pressurised) return { ...base, fits: false, reason: 'needs a pressurised tank' };
  if (!pressure && bulk.pressurised) return { ...base, fits: false, reason: 'pressure tank: liquefied gas only' };
  const pct = maxFillPct(m.materialId, m.state) / 100;
  const large = bulk.compartments.filter((c) => m.volumeL <= c.capacityL * pct + EPS);
  if (!large.length) {
    const biggest = Math.max(0, ...bulk.compartments.map((c) => c.capacityL));
    return { ...base, fits: false, reason: `no compartment large enough (max ${formatMaterialVolume(biggest * pct, 'liquid', settings.units, 0)} per fill)` };
  }
  if (spec.isFood && !bulk.foodGrade) return { ...base, fits: false, reason: 'needs a food-grade tank' };
  if (spec.temp !== 'ambient' && !bulk.insulated) return { ...base, fits: false, reason: 'needs an insulated tank' };
  if (spec.weightKg > v.payloadKg) return { ...base, fits: false, reason: 'heavier than the payload' };
  return { ...base, fits: true, detail: large.map((c) => c.label).join(', ') };
}

/** Dump-truck check for a dry-bulk load: struck body capacity and the legal maximum from the axle / payload / gross limits. */
function fitTipper(m: MaterialContents, v: Vehicle, settings: PlanSettings): VehicleFit {
  const base = { id: v.id, name: v.name };
  const legal = bestLegalFill(v, m);
  if (!legal) return { ...base, fits: false, reason: 'no dump body' };
  const detail = `legal max ${formatMaterialVolume(legal.litres, 'solid', settings.units, 1)} (${legal.limitedBy.toLowerCase()})`;
  const capacity = (legal.compartment.capacityL * maxFillPct(m.materialId, m.state)) / 100;
  if (m.volumeL > capacity + EPS) return { ...base, fits: false, detail, reason: `body too small (${formatMaterialVolume(capacity, 'solid', settings.units, 1)} level full)` };
  if (m.volumeL > legal.litres + EPS) return { ...base, fits: false, detail, reason: 'overloaded' };
  return { ...base, fits: true, detail };
}

/**
 * Whether one unit can ride in a vehicle. Bulk fills: a matching tank compartment or dump body holds it
 * legally. Other units: fits the cargo space (and the door, for rear-only vehicles) in some allowed orientation.
 */
export function fitVehicle(spec: ItemSpec, v: Vehicle, settings: PlanSettings): VehicleFit {
  const base = { id: v.id, name: v.name };
  if (isBulk(spec)) {
    const m = spec.material;
    if (!m) return { ...base, fits: false, reason: 'no material' };
    if (!vehicleSuits(spec, v)) return { ...base, fits: false, reason: m.state === 'liquid' ? 'not a tanker' : 'not a dump truck' };
    return m.state === 'liquid' ? fitTank(spec, m, v, settings) : fitTipper(m, v, settings);
  }
  if (v.bulk) return { ...base, fits: false, reason: v.bulk.kind === 'tank' ? 'tankers carry bulk liquids only' : 'dump trucks carry loose bulk only' };
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
  /** Plan vehicles of the relevant kind (tankers for liquid fills, dump trucks for dry bulk, the others otherwise). */
  planFits: VehicleFit[];
  presetFits: VehicleFit[];
}

export function deriveItem(spec: ItemSpec, plan: Plan): Derived {
  const bulk = isBulk(spec);
  const relevant = (v: Vehicle) => vehicleSuits(spec, v);
  const volume = bulk ? (spec.material?.volumeL ?? 0) / 1000 : volumeOf(spec.dims);
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
  | 'materialName';

export interface DraftIssues {
  errors: Partial<Record<DraftField, string>>;
  /** Errors not bound to a single field (e.g. fits no vehicle). */
  blocking: string[];
  warnings: string[];
}

export const UN_PATTERN = /^UN\d{4}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Dry-bulk load above every considered dump truck's legal max: the split into equal legal loads (best truck). */
function overloadSplit(m: MaterialContents, trucks: Vehicle[]): { count: number; volumeL: number } | null {
  const legal = Math.max(0, ...trucks.map((v) => bestLegalFill(v, m)?.litres ?? 0));
  return legal > 0 && m.volumeL > legal + EPS ? splitLegalLoads(m.volumeL, legal) : null;
}

/** Validation of an item-editor draft against the plan's vehicles, the vehicle presets and settings. */
export function checkDraft(draft: LineDraft, plan: Plan, derived: Derived): DraftIssues {
  const { spec } = draft;
  const sys = plan.settings.units;
  const bulk = isBulk(spec);
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

  const m = spec.material;
  if (m) {
    if (!m.name.trim()) errors.materialName = 'Name the material';
    if (!(m.densityKgPerL > 0)) errors.density = 'Density must be positive';
    if (!(m.volumeL > 0)) errors.volume = 'Volume must be positive';
    const cap = bulk ? undefined : containerCapacityL(spec);
    if (cap && m.volumeL > 0) {
      const pct = maxFillPct(m.materialId, m.state);
      if (m.volumeL > cap + EPS) errors.volume = `Exceeds the container capacity of ${formatMaterialVolume(cap, m.state, sys)}`;
      else if (m.volumeL > (cap * pct) / 100 + EPS) warnings.push(`Above the ${pct} % max fill (${formatMaterialVolume((cap * pct) / 100, m.state, sys)}): leave room for thermal expansion`);
    }
  }

  if (!errors.dims && !errors.weight && !errors.volume) {
    const planOk = derived.planFits.some((f) => f.fits);
    const presetOk = derived.presetFits.some((f) => f.fits);
    if (bulk && m?.state === 'solid') {
      // Dry bulk is order data: an over-limit load is split into legal loads rather than refused.
      const planTrucks = plan.vehicles.filter((v) => vehicleSuits(spec, v));
      const split = planOk ? null : overloadSplit(m, planTrucks.length ? planTrucks : presetVehicleList().filter((v) => vehicleSuits(spec, v)));
      if (split) warnings.push(`Overloads every dump truck${planTrucks.length ? ' in this plan' : ''}; split into ${split.count} loads of ${formatMaterialVolume(split.volumeL, 'solid', sys, 1)}`);
      else if (!planOk && !planTrucks.length) warnings.push('Needs a dump truck: add one that can carry it');
    } else if (bulk) {
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

export interface SplitAdvice {
  /** Fills each current fill becomes. */
  count: number;
  /** Volume of each new fill, litres. */
  volumeL: number;
  /** Legal maximum the advice is based on, litres, and what limits it. */
  legalL: number;
  limitedBy: string;
  vehicleName: string;
}

/**
 * "Split into legal loads" advice for a bulk line whose fill exceeds the legal maximum: of the vehicle and
 * compartment it is placed in (with the rest of that vehicle's cargo), or of the best matching plan vehicle
 * when unplaced. Null when the fill is legal or no matching vehicle exists.
 */
export function splitAdvice(plan: Plan, line: CargoLine): SplitAdvice | null {
  const m = line.spec.material;
  if (!isBulk(line.spec) || !m || !(m.volumeL > 0) || !(m.densityKgPerL > 0)) return null;
  const placed = Object.values(plan.placements).find((p) => lineIdOfUnit(p.unitId) === line.id && p.compartmentId);
  let legal: { litres: number; limitedBy: string; vehicle: Vehicle } | null = null;
  if (placed) {
    const v = plan.vehicles.find((x) => x.id === placed.vehicleId);
    const c = v?.bulk?.compartments.find((x) => x.id === placed.compartmentId);
    if (v && c) {
      const others = evaluatePlan(plan).byVehicle[v.id]?.points.filter((p) => p.id !== placed.unitId) ?? [];
      legal = { ...maxLegalFill(v, others, c, m), vehicle: v };
    }
  } else {
    for (const v of plan.vehicles.filter((x) => vehicleSuits(line.spec, x))) {
      const fill = bestLegalFill(v, m);
      if (fill && (!legal || fill.litres > legal.litres)) legal = { litres: fill.litres, limitedBy: fill.limitedBy, vehicle: v };
    }
  }
  if (!legal || !(legal.litres > 0) || m.volumeL <= legal.litres + EPS) return null;
  return { ...splitLegalLoads(m.volumeL, legal.litres), legalL: legal.litres, limitedBy: legal.limitedBy, vehicleName: legal.vehicle.name };
}

export interface BulkCardDefault {
  /** Suggested litres per fill: the template volume, capped at the best free compartment's legal maximum. */
  volumeL: number;
  /** Best free compartment of the vehicle and its legal maximum for this material (on top of the cargo aboard). */
  legal?: { litres: number; limitedBy: string; label: string; pctOfCapacity: number };
  /** Why the vehicle cannot take the material ("Needs a tanker", "Needs a food-grade tank", "No free compartment"). */
  problem?: string;
}

/**
 * Default volume for a bulk template card in the cargo palette: when the vehicle can carry the material,
 * the template volume capped at the largest legal fill of its free compartments (maxLegalFill with the
 * cargo already aboard); otherwise the template volume with the reason it does not fit.
 */
export function bulkCardDefault(plan: Plan, vehicle: Vehicle, spec: ItemSpec): BulkCardDefault {
  const m = spec.material;
  const volumeL = m?.volumeL ?? 0;
  if (!m || !isBulk(spec)) return { volumeL };
  if (!vehicleSuits(spec, vehicle)) return { volumeL, problem: m.state === 'solid' ? 'Needs a dump truck' : 'Needs a tanker' };
  // Compatibility (pressure, food grade, insulation) independent of size: check a 1-litre fill.
  const compat = fitVehicle({ ...spec, weightKg: m.densityKgPerL, material: { ...m, volumeL: 1 } }, vehicle, plan.settings);
  if (!compat.fits) return { volumeL, problem: capitalise(compat.reason ?? 'does not fit') };
  const used = new Set(Object.values(plan.placements).filter((p) => p.vehicleId === vehicle.id && p.compartmentId).map((p) => p.compartmentId));
  const others = evaluatePlan(plan).byVehicle[vehicle.id]?.points ?? [];
  let best: BulkCardDefault['legal'];
  for (const c of vehicle.bulk!.compartments) {
    if (used.has(c.id)) continue;
    const fill = maxLegalFill(vehicle, others, c, m);
    if (!best || fill.litres > best.litres) best = { litres: fill.litres, limitedBy: fill.limitedBy, label: c.label, pctOfCapacity: (fill.litres / c.capacityL) * 100 };
  }
  if (!best) return { volumeL, problem: 'No free compartment' };
  if (best.litres < 1) return { volumeL, problem: `No legal room left (${best.limitedBy.toLowerCase()})` };
  return { volumeL: Math.min(volumeL, best.litres), legal: best };
}
