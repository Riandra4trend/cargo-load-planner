import { HAZMAT_CLASS_NAMES } from '../domain/settings';
import { hazmatColor, heatColor, stopColor, TEMP_COLORS, TEMP_LABELS } from '../domain/colors';
import type { CargoUnit, ColorMode, Id, Plan, TempClass } from '../domain/types';

/** Inputs shared by every unit colour lookup of one render. */
export interface ColorContext {
  mode: ColorMode;
  /** Stop id -> customer colour. */
  stopColors: Map<Id, string>;
  /** Heaviest unit weight (weight heat map scale), kg. */
  maxKg: number;
}

export function colorContext(plan: Plan, units: readonly CargoUnit[], mode: ColorMode): ColorContext {
  const customerColor = new Map(plan.customers.map((c) => [c.id, c.color]));
  const stopColors = new Map(plan.stops.map((s) => [s.id, customerColor.get(s.customerId) ?? stopColor(s.sequence)]));
  let maxKg = 0;
  for (const u of units) maxKg = Math.max(maxKg, u.spec.weightKg);
  return { mode, stopColors, maxKg };
}

export const NEUTRAL_COLOR = hazmatColor(undefined);

/** Display colour of a unit for the active colour mode. */
export function unitColor(unit: CargoUnit, ctx: ColorContext): string {
  switch (ctx.mode) {
    case 'customer':
      return unit.spec.color ?? ctx.stopColors.get(unit.stopId) ?? NEUTRAL_COLOR;
    case 'temperature':
      return TEMP_COLORS[unit.spec.temp];
    case 'hazmat':
      return unit.spec.hazmat ? hazmatColor(unit.spec.hazmat.hazClass) : NEUTRAL_COLOR;
    case 'weight':
      return heatColor(ctx.maxKg > 0 ? unit.spec.weightKg / ctx.maxKg : 0);
    default:
      return ctx.stopColors.get(unit.stopId) ?? NEUTRAL_COLOR;
  }
}

export interface LegendEntry {
  key: string;
  color: string;
  label: string;
}

/** Legend rows for the categorical colour modes (the weight mode uses a gradient instead). */
export function legendEntries(plan: Plan, units: readonly CargoUnit[], ctx: ColorContext): LegendEntry[] {
  switch (ctx.mode) {
    case 'stop':
      return [...plan.stops]
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => ({ key: s.id, color: ctx.stopColors.get(s.id) ?? NEUTRAL_COLOR, label: `${s.sequence} · ${plan.customers.find((c) => c.id === s.customerId)?.name ?? s.name}` }));
    case 'customer': {
      const rows: LegendEntry[] = plan.customers.map((c) => ({ key: c.id, color: c.color, label: c.name }));
      const custom = new Map<string, string>();
      for (const u of units) if (u.spec.color && !custom.has(u.spec.color)) custom.set(u.spec.color, u.spec.name);
      for (const [color, name] of custom) rows.push({ key: `custom-${color}`, color, label: `${name} (item colour)` });
      return rows;
    }
    case 'temperature': {
      const present = new Set(units.map((u) => u.spec.temp));
      return (Object.keys(TEMP_COLORS) as TempClass[])
        .filter((t) => present.has(t) || t === 'ambient')
        .map((t) => ({ key: t, color: TEMP_COLORS[t], label: TEMP_LABELS[t] }));
    }
    case 'hazmat': {
      const classes = [...new Set(units.flatMap((u) => (u.spec.hazmat ? [u.spec.hazmat.hazClass] : [])))].sort();
      return [
        ...classes.map((c) => ({ key: c, color: hazmatColor(c), label: `Class ${c}${HAZMAT_CLASS_NAMES[c] ? ` · ${HAZMAT_CLASS_NAMES[c]}` : ''}` })),
        { key: 'none', color: NEUTRAL_COLOR, label: 'Not dangerous goods' },
      ];
    }
    default:
      return [];
  }
}
