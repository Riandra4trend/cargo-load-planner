import { materialDef } from '../domain/materials';
import { defaultFuelProfile } from '../domain/presets';
import { defaultSettings } from '../domain/settings';
import type { BulkSpec, ItemSpec, MaterialContents, PackagingKind, Plan, PlanMeta, Vehicle } from '../domain/types';

/** Liquid contents as saved before dry bulk existed (wave 1). */
interface LegacyLiquid {
  liquidId: string;
  name: string;
  densityKgPerL: number;
  volumeL: number;
  containerCapacityL?: number;
}
type LegacySpec = Omit<ItemSpec, 'packaging'> & { packaging: PackagingKind | 'bulk-liquid'; liquid?: LegacyLiquid };
type LegacyBulk = Omit<BulkSpec, 'kind' | 'pressurised'> & { kind?: BulkSpec['kind']; pressurised?: boolean };
type LegacyVehicle = Omit<Vehicle, 'bulk'> & { bulk?: LegacyBulk; tank?: LegacyBulk };

/**
 * Brings an item spec saved by an older version up to date: `liquid { liquidId }` becomes
 * `material { materialId, state }` and the 'bulk-liquid' packaging becomes 'bulk'. Mutates and returns it.
 */
export function upgradeSpec(spec: ItemSpec): ItemSpec {
  const legacy = spec as unknown as LegacySpec;
  if (legacy.liquid) {
    const { liquidId, ...rest } = legacy.liquid;
    if (!spec.material) spec.material = { ...rest, materialId: liquidId, state: 'liquid' };
    delete legacy.liquid;
  }
  if (legacy.packaging === 'bulk-liquid') spec.packaging = 'bulk';
  const m = spec.material as (Omit<MaterialContents, 'state'> & { state?: MaterialContents['state'] }) | undefined;
  if (m && m.state === undefined) spec.material = { ...m, state: materialDef(m.materialId)?.state ?? 'liquid' };
  return spec;
}

/** `vehicle.tank` (wave 1) becomes `vehicle.bulk` with kind 'tank'; flags added later default to false. */
function upgradeVehicle(v: Vehicle): void {
  const legacy = v as unknown as LegacyVehicle;
  const bulk = legacy.bulk ?? legacy.tank;
  delete legacy.tank;
  if (!bulk) return;
  v.bulk = { ...bulk, kind: bulk.kind ?? 'tank', pressurised: bulk.pressurised ?? false };
}

/** Triggers a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'load-plan'
  );
}

/** Downloads the full plan as versioned JSON (exact round trip with readPlanFile). */
export function downloadPlanJson(plan: Plan): void {
  downloadBlob(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }), `${fileSlug(plan.name)}.loadplan.json`);
}

/**
 * Fills fields added after a plan was saved (fuel profiles and settings, per-stop leg distances, the
 * return leg, the tank pressure flag) and renames legacy fields (`spec.liquid` → `spec.material`,
 * 'bulk-liquid' → 'bulk', `vehicle.tank` → `vehicle.bulk`), so older files, share links and autosaves
 * keep loading. A legacy route total is spread evenly over the stops that have no leg distance.
 */
function upgradePlan(plan: Plan): Plan {
  plan.settings = { ...defaultSettings(), ...plan.settings };
  const meta = plan.meta as PlanMeta & { distanceKm?: number };
  const legacyKm = meta.distanceKm;
  delete meta.distanceKm;
  if (typeof meta.returnKm !== 'number' || !Number.isFinite(meta.returnKm)) meta.returnKm = 0;
  const missing = plan.stops.filter((s) => s && s.distanceKm === undefined);
  if (typeof legacyKm === 'number' && legacyKm > 0 && missing.length) {
    const known = plan.stops.reduce((sum, s) => sum + (s?.distanceKm ?? 0), 0);
    const each = Math.max(0, legacyKm - known) / missing.length;
    for (const s of missing) s.distanceKm = Math.round(each * 10) / 10;
  }
  for (const v of plan.vehicles) {
    if (!v) continue;
    upgradeVehicle(v);
    if (!v.fuel) v.fuel = defaultFuelProfile(v);
  }
  for (const l of plan.lines) if (l?.spec) upgradeSpec(l.spec);
  return plan;
}

/** Parses and validates plan JSON; throws an Error with a readable message when invalid. */
export function parsePlanJson(text: string): Plan {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const p = data as Partial<Plan> | null;
  if (!p || typeof p !== 'object' || p.version !== 1) throw new Error('Not a LoadPlanner plan file (expected version 1).');
  for (const key of ['customers', 'stops', 'lines', 'vehicles'] as const) {
    if (!Array.isArray(p[key])) throw new Error(`Plan file is missing "${key}".`);
  }
  if (!p.vehicles!.length) throw new Error('Plan file has no vehicles.');
  if (!p.placements || typeof p.placements !== 'object') throw new Error('Plan file is missing "placements".');
  if (!p.settings || !p.meta) throw new Error('Plan file is missing settings or details.');
  if (typeof p.id !== 'string' || typeof p.name !== 'string') throw new Error('Plan file is missing its id or name.');
  const plan = upgradePlan(p as Plan);
  const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const customerIds = new Set(plan.customers.map((c) => c?.id));
  const stopIds = new Set(plan.stops.map((s) => s?.id));
  const vehicleIds = new Set(plan.vehicles.map((v) => v?.id));
  for (const s of plan.stops) {
    if (typeof s?.id !== 'string' || !customerIds.has(s.customerId)) throw new Error(`Stop "${s?.name ?? '?'}" refers to an unknown customer.`);
  }
  for (const l of plan.lines) {
    const d = l?.spec?.dims;
    if (typeof l?.id !== 'string' || !d || !isNum(d.l) || !isNum(d.w) || !isNum(d.h) || !isNum(l.spec.weightKg)) throw new Error(`Item "${l?.spec?.name ?? '?'}" has invalid dimensions or weight.`);
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new Error(`Item "${l.spec.name}" has an invalid quantity.`);
    if (!stopIds.has(l.stopId)) throw new Error(`Item "${l.spec.name}" refers to an unknown stop.`);
    const m = l.spec.material;
    if (m && (!isNum(m.volumeL) || !isNum(m.densityKgPerL) || typeof m.materialId !== 'string' || (m.state !== 'liquid' && m.state !== 'solid'))) {
      throw new Error(`Item "${l.spec.name}" has invalid material contents.`);
    }
  }
  for (const v of plan.vehicles) {
    if (typeof v?.id !== 'string' || !v.cargo || !isNum(v.cargo.l) || (v.statics?.type !== 'rigid' && v.statics?.type !== 'artic')) throw new Error(`Vehicle "${v?.name ?? '?'}" is incomplete.`);
    const b = v.bulk;
    if (b && ((b.kind !== 'tank' && b.kind !== 'tipper') || !Array.isArray(b.compartments) || b.compartments.some((c) => typeof c?.id !== 'string' || !isNum(c.fromX) || !isNum(c.toX) || !isNum(c.capacityL)))) {
      throw new Error(`Vehicle "${v.name}" has an invalid tank or dump body.`);
    }
  }
  const vehicleById = new Map(plan.vehicles.map((v) => [v.id, v]));
  for (const [unitId, pl] of Object.entries(plan.placements)) {
    if (!pl || !vehicleIds.has(pl.vehicleId) || !pl.pos || !isNum(pl.pos.x)) throw new Error('Plan file has an invalid placement.');
    // A fill whose compartment no longer exists (vehicle edited or swapped) goes back to Unplaced.
    if (pl.compartmentId !== undefined && !vehicleById.get(pl.vehicleId)?.bulk?.compartments.some((c) => c.id === pl.compartmentId)) delete plan.placements[unitId];
  }
  return plan;
}

export async function readPlanFile(file: File): Promise<Plan> {
  return parsePlanJson(await file.text());
}
