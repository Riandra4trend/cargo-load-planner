import { compartmentFill, compartmentOf, isBulkLiquid } from '../../domain/geometry';
import { liquidColor, maxFillPct } from '../../domain/liquids';
import type { CargoUnit, Plan, TankCompartment, UnitSystem, Vehicle } from '../../domain/types';
import { formatLitres, formatPercent, litreParts } from '../../domain/units';

/** One tanker compartment with the fill(s) placed in it (more than one fill is a hard violation). */
export interface CompartmentRow {
  compartment: TankCompartment;
  fills: CargoUnit[];
  volumeL: number;
  /** Fill of the brim capacity, 0..1. */
  fill: number;
  /** Highest safe fill of the (first) liquid, 0..1 (97 % when empty). */
  maxFill: number;
  kg: number;
  color: string;
}

/** Litres of a bulk (or packaged) liquid unit, 0 when it carries no liquid. */
export const unitLitres = (u: CargoUnit): number => u.spec.liquid?.volumeL ?? 0;

/** Cargo litres formatted without decimals: "7,700 L" / "2,034 gal". */
export const formatCargoLitres = (litres: number, sys: UnitSystem): string => formatLitres(litres, sys, 0);

/** "7,700 / 8,000 L" in the plan's volume unit. */
export function litrePair(litres: number, capacityL: number, sys: UnitSystem): string {
  return `${litreParts(litres, sys, 0)[0]} / ${formatCargoLitres(capacityL, sys)}`;
}

/** "Diesel 7,700 L · Stop 1" */
export function bulkLabel(u: CargoUnit, sys: UnitSystem): string {
  return `${u.spec.liquid?.name ?? u.spec.name} ${formatCargoLitres(unitLitres(u), sys)} · Stop ${u.stopSeq}`;
}

/** Load instruction for a bulk fill: "Fill C2 with Gasoline 5,800 L (97 % full)". */
export function fillInstruction(v: Vehicle, u: CargoUnit, compartmentId: string | undefined, sys: UnitSystem): string {
  const c = compartmentOf(v, compartmentId);
  const what = `${u.spec.liquid?.name ?? u.spec.name} ${formatCargoLitres(unitLitres(u), sys)}`;
  return c ? `Fill ${c.label} with ${what} (${formatPercent(compartmentFill(u.spec, c))} full)` : `Fill ${what}`;
}

/** Unload instruction for a bulk fill: "Discharge C1 · Diesel 7,700 L at Stop 1". */
export function dischargeInstruction(plan: Plan, u: CargoUnit, sys: UnitSystem): string {
  const p = plan.placements[u.id];
  const v = plan.vehicles.find((x) => x.id === p?.vehicleId);
  const c = v ? compartmentOf(v, p?.compartmentId) : undefined;
  return `Discharge ${c ? `${c.label} · ` : ''}${u.spec.liquid?.name ?? u.spec.name} ${formatCargoLitres(unitLitres(u), sys)} at Stop ${u.stopSeq}`;
}

/** Total brim capacity of a tanker, litres. */
export const tankCapacityL = (v: Vehicle): number => v.tank?.compartments.reduce((sum, c) => sum + c.capacityL, 0) ?? 0;

/** Compartments of a tanker in front-to-rear order with their fills, from the plan's placements. */
export function compartmentRows(plan: Plan, units: readonly CargoUnit[], v: Vehicle): CompartmentRow[] {
  if (!v.tank) return [];
  return v.tank.compartments.map((compartment) => {
    const fills = units.filter((u) => {
      const p = plan.placements[u.id];
      return p?.vehicleId === v.id && p.compartmentId === compartment.id && isBulkLiquid(u.spec);
    });
    const first = fills[0]?.spec.liquid;
    return {
      compartment,
      fills,
      volumeL: fills.reduce((sum, u) => sum + unitLitres(u), 0),
      fill: fills.reduce((sum, u) => sum + compartmentFill(u.spec, compartment), 0),
      maxFill: maxFillPct(first?.liquidId ?? '') / 100,
      kg: fills.reduce((sum, u) => sum + u.spec.weightKg, 0),
      color: first ? liquidColor(first.liquidId) : '#D9D6CF',
    };
  });
}

/** Contents text for packaged liquids in normal rows: "200 L Diesel"; empty for other units. */
export function packagedContents(u: Pick<CargoUnit, 'spec'>, sys: UnitSystem): string {
  const l = u.spec.liquid;
  return l && !isBulkLiquid(u.spec) ? `${formatLitres(l.volumeL, sys, l.volumeL < 100 ? 1 : 0)} ${l.name}` : '';
}
