import { compartmentFill, compartmentOf, isBulk } from '../../domain/geometry';
import { materialColor, maxFillPct } from '../../domain/materials';
import type { CargoUnit, Compartment, MaterialState, Plan, UnitSystem, Vehicle } from '../../domain/types';
import { formatMaterialVolume, formatPercent, materialVolumeParts } from '../../domain/units';
import { computeAxleState, maxLegalFill, type MassPoint } from '../../physics';

/** One bulk compartment (tank compartment or dump body) with the fill(s) placed in it (more than one is a hard violation). */
export interface CompartmentRow {
  compartment: Compartment;
  fills: CargoUnit[];
  volumeL: number;
  /** Fill of the brim / struck capacity, 0..1. */
  fill: number;
  /** Highest safe fill of the (first) material, 0..1 (100 % for solids, 97 % for liquids when empty). */
  maxFill: number;
  kg: number;
  color: string;
  /** Largest legal volume of the first fill's material here on top of the vehicle's other cargo (needs mass points). */
  legal?: { litres: number; limitedBy: string };
  /** Set instead of `legal` when the vehicle's other cargo alone already breaks this limit (a distribution problem, not this fill's volume). */
  blockedBy?: string;
}

/** Material state carried by a bulk vehicle: tippers carry solids, tanks liquids. */
export const bulkState = (v: Vehicle): MaterialState => (v.bulk?.kind === 'tipper' ? 'solid' : 'liquid');

/** "Tank compartments" or "Dump body". */
export const bulkTitle = (v: Vehicle): string => (v.bulk?.kind === 'tipper' ? 'Dump body' : 'Tank compartments');

/** Reference end for COG readouts: "tank front", "body front" or "front wall". */
export const frontLabel = (v: Vehicle): string => (v.bulk ? (v.bulk.kind === 'tipper' ? 'body front' : 'tank front') : 'front wall');

/** Material state of a unit (liquid when it carries no material). */
export const unitState = (u: Pick<CargoUnit, 'spec'>): MaterialState => u.spec.material?.state ?? 'liquid';

/** Litres of a bulk (or packaged) material unit, 0 when it carries none. */
export const unitLitres = (u: Pick<CargoUnit, 'spec'>): number => u.spec.material?.volumeL ?? 0;

const DIGITS: Record<MaterialState, number> = { liquid: 0, solid: 1 };

/** Bulk volume: liquids "7,700 L" / "2,034 gal", solids "10.0 m³" / "13.1 yd³". */
export const formatBulkVolume = (litres: number, state: MaterialState, sys: UnitSystem): string => formatMaterialVolume(litres, state, sys, DIGITS[state]);

/** Numeric part only, for "a / b unit" pairs and KPI values. */
export const bulkVolumeValue = (litres: number, state: MaterialState, sys: UnitSystem): string => materialVolumeParts(litres, state, sys, DIGITS[state])[0];

/** "7,700 / 8,000 L" or "10.0 / 16.0 m³". */
export function volumePair(litres: number, capacityL: number, state: MaterialState, sys: UnitSystem): string {
  return `${bulkVolumeValue(litres, state, sys)} / ${formatBulkVolume(capacityL, state, sys)}`;
}

const materialName = (u: CargoUnit): string => u.spec.material?.name ?? u.spec.name;

/** "Diesel 7,700 L · Stop 1" / "Sand (wet) 10.0 m³ · Stop 1" */
export function bulkLabel(u: CargoUnit, sys: UnitSystem): string {
  return `${materialName(u)} ${formatBulkVolume(unitLitres(u), unitState(u), sys)} · Stop ${u.stopSeq}`;
}

/** Load instruction: "Fill C2 with Gasoline 5,800 L (97 % full)" or "Load Sand (wet) 10.0 m³ into the body (62 % full)". */
export function fillInstruction(v: Vehicle, u: CargoUnit, compartmentId: string | undefined, sys: UnitSystem): string {
  const c = compartmentOf(v, compartmentId);
  const what = `${materialName(u)} ${formatBulkVolume(unitLitres(u), unitState(u), sys)}`;
  const pct = c ? ` (${formatPercent(compartmentFill(u.spec, c))} full)` : '';
  if (v.bulk?.kind === 'tipper') return `Load ${what} into the body${pct}`;
  return c ? `Fill ${c.label} with ${what}${pct}` : `Fill ${what}`;
}

/** Unload instruction: "Discharge C1 · Diesel 7,700 L at Stop 1" or "Tip the body at Stop 1 · Sand (wet) 10.0 m³". */
export function dischargeInstruction(plan: Plan, u: CargoUnit, sys: UnitSystem): string {
  const p = plan.placements[u.id];
  const v = plan.vehicles.find((x) => x.id === p?.vehicleId);
  const what = `${materialName(u)} ${formatBulkVolume(unitLitres(u), unitState(u), sys)}`;
  if (v?.bulk?.kind === 'tipper') return `Tip the body at Stop ${u.stopSeq} · ${what}`;
  const c = v ? compartmentOf(v, p?.compartmentId) : undefined;
  return `Discharge ${c ? `${c.label} · ` : ''}${what} at Stop ${u.stopSeq}`;
}

/** Total capacity of a bulk vehicle's compartments, litres. */
export const bulkCapacityL = (v: Vehicle): number => v.bulk?.compartments.reduce((sum, c) => sum + c.capacityL, 0) ?? 0;

/** "32,000 L · 5 compartments" for tankers, "16.0 m³ body" for tippers. */
export function bulkSummary(v: Vehicle, sys: UnitSystem): string {
  const n = v.bulk?.compartments.length ?? 0;
  const cap = formatBulkVolume(bulkCapacityL(v), bulkState(v), sys);
  return v.bulk?.kind === 'tipper' ? `${cap} body` : `${cap} · ${n} compartment${n === 1 ? '' : 's'}`;
}

/**
 * Compartments in front-to-rear order with their fills. With the vehicle's mass points, each filled row
 * also gets the legal maximum of its material on top of the other cargo (overload / ODOL check).
 */
export function compartmentRows(plan: Plan, units: readonly CargoUnit[], v: Vehicle, points?: readonly MassPoint[]): CompartmentRow[] {
  if (!v.bulk) return [];
  const state = bulkState(v);
  return v.bulk.compartments.map((compartment) => {
    const fills = units.filter((u) => {
      const p = plan.placements[u.id];
      return p?.vehicleId === v.id && p.compartmentId === compartment.id && isBulk(u.spec);
    });
    const first = fills[0]?.spec.material;
    const ids = new Set(fills.map((u) => u.id));
    const others = points?.filter((p) => !ids.has(p.id));
    const othersState = first && others ? computeAxleState(v, others) : null;
    const othersBroken = othersState ? othersState.grossOver || othersState.status === 'over' || othersState.status === 'under' : false;
    const legal = first && others ? maxLegalFill(v, others, compartment, first) : undefined;
    return {
      compartment,
      fills,
      volumeL: fills.reduce((sum, u) => sum + unitLitres(u), 0),
      fill: fills.reduce((sum, u) => sum + compartmentFill(u.spec, compartment), 0),
      maxFill: maxFillPct(first?.materialId ?? '', first?.state ?? state) / 100,
      kg: fills.reduce((sum, u) => sum + u.spec.weightKg, 0),
      color: first ? materialColor(first.materialId, first.state) : '#D9D6CF',
      legal: othersBroken ? undefined : legal,
      blockedBy: othersBroken ? legal?.limitedBy : undefined,
    };
  });
}

/** Volume above the legal maximum (litres, 0 when legal or when the other cargo is to blame) and its weight. */
export function overload(row: CompartmentRow): { litres: number; kg: number } {
  const first = row.fills[0]?.spec.material;
  if (!first || !row.legal) return { litres: 0, kg: 0 };
  const litres = Math.max(0, row.volumeL - row.legal.litres);
  return litres < 0.5 ? { litres: 0, kg: 0 } : { litres, kg: litres * first.densityKgPerL };
}

/** Contents text for packaged materials in normal rows: "200 L Diesel"; empty for other units. */
export function packagedContents(u: Pick<CargoUnit, 'spec'>, sys: UnitSystem): string {
  const m = u.spec.material;
  if (!m || isBulk(u.spec)) return '';
  const digits = m.state === 'solid' ? 2 : m.volumeL < 100 ? 1 : 0;
  return `${formatMaterialVolume(m.volumeL, m.state, sys, digits)} ${m.name}`;
}
