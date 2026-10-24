import type { Dims, UnitSystem } from './types';

/** Exact conversion factors. */
export const M_PER_IN = 0.0254;
export const M_PER_FT = 0.3048;
export const KG_PER_LB = 0.45359237;

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type WeightUnit = 'kg' | 't' | 'lb';

export const LENGTH_UNITS: LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];
export const WEIGHT_UNITS: WeightUnit[] = ['kg', 't', 'lb'];

const LENGTH_FACTOR: Record<LengthUnit, number> = { mm: 0.001, cm: 0.01, m: 1, in: M_PER_IN, ft: M_PER_FT };
const WEIGHT_FACTOR: Record<WeightUnit, number> = { kg: 1, t: 1000, lb: KG_PER_LB };

export const toMetres = (value: number, unit: LengthUnit): number => value * LENGTH_FACTOR[unit];
export const fromMetres = (metres: number, unit: LengthUnit): number => metres / LENGTH_FACTOR[unit];
export const toKg = (value: number, unit: WeightUnit): number => value * WEIGHT_FACTOR[unit];
export const fromKg = (kg: number, unit: WeightUnit): number => kg / WEIGHT_FACTOR[unit];
export const lbToKg = (lb: number): number => lb * KG_PER_LB;
export const kgToLb = (kg: number): number => kg / KG_PER_LB;

/** Default input/display unit for item-sized lengths (metric: m, imperial: in). */
export const itemLengthUnit = (sys: UnitSystem): LengthUnit => (sys === 'metric' ? 'm' : 'in');
/** Default display unit for vehicle-sized lengths (metric: m, imperial: ft). */
export const bigLengthUnit = (sys: UnitSystem): LengthUnit => (sys === 'metric' ? 'm' : 'ft');
export const weightUnit = (sys: UnitSystem): WeightUnit => (sys === 'metric' ? 'kg' : 'lb');

/** One formatter per digit count: toLocaleString builds a new formatter on every call, which dominates large tables and rule messages. */
const numberFormats = new Map<number, Intl.NumberFormat>();

export function formatNumber(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '-';
  let format = numberFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numberFormats.set(digits, format);
  }
  return format.format(n);
}

const LENGTH_DIGITS: Record<LengthUnit, number> = { mm: 0, cm: 0, m: 2, in: 1, ft: 1 };

/** "1.20 m", "47.2 in", "52.5 ft". */
export function formatLength(metres: number, sys: UnitSystem, opts: { unit?: LengthUnit; digits?: number; big?: boolean } = {}): string {
  const unit = opts.unit ?? (opts.big ? bigLengthUnit(sys) : itemLengthUnit(sys));
  const digits = opts.digits ?? LENGTH_DIGITS[unit];
  return `${formatNumber(fromMetres(metres, unit), digits)} ${unit}`;
}

/** "1.20 × 0.80 × 1.60 m" or "47.2 × 31.5 × 63.0 in". */
export function formatDims(d: Dims, sys: UnitSystem, opts: { big?: boolean } = {}): string {
  const unit = opts.big ? bigLengthUnit(sys) : itemLengthUnit(sys);
  const digits = LENGTH_DIGITS[unit];
  const f = (m: number) => formatNumber(fromMetres(m, unit), digits);
  return `${f(d.l)} × ${f(d.w)} × ${f(d.h)} ${unit}`;
}

/** "5,815 kg" or "12,820 lb". */
export function formatWeight(kg: number, sys: UnitSystem, opts: { unit?: WeightUnit; digits?: number } = {}): string {
  const unit = opts.unit ?? weightUnit(sys);
  const digits = opts.digits ?? (unit === 't' ? 2 : 0);
  return `${formatNumber(fromKg(kg, unit), digits)} ${unit}`;
}

/** Large masses: metric "8.15 t", imperial "17,968 lb". */
export function formatMass(kg: number, sys: UnitSystem): string {
  return sys === 'metric' ? formatWeight(kg, sys, { unit: 't', digits: 2 }) : formatWeight(kg, sys, { unit: 'lb' });
}

/** Large masses split into value and unit for KPI cards: ["8.15", "t"]. */
export function massParts(kg: number, sys: UnitSystem): [string, string] {
  return sys === 'metric' ? [formatNumber(kg / 1000, 2), 't'] : [formatNumber(kgToLb(kg), 0), 'lb'];
}

/** 0.853 -> "85 %" */
export function formatPercent(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return '-';
  return `${formatNumber(ratio * 100, digits)} %`;
}

export function formatVolume(m3: number, sys: UnitSystem): string {
  return sys === 'metric' ? `${formatNumber(m3, 2)} m³` : `${formatNumber(m3 / M_PER_FT ** 3, 1)} ft³`;
}

export function formatDensity(kgPerM3: number, sys: UnitSystem): string {
  return sys === 'metric'
    ? `${formatNumber(kgPerM3, 0)} kg/m³`
    : `${formatNumber(kgToLb(kgPerM3) * M_PER_FT ** 3, 1)} lb/ft³`;
}

export function formatArea(m2: number, sys: UnitSystem): string {
  return sys === 'metric' ? `${formatNumber(m2, 2)} m²` : `${formatNumber(m2 / M_PER_FT ** 2, 1)} ft²`;
}

/** Parses a user-typed number, accepting "," as decimal separator. Returns NaN when invalid. */
export function parseNumber(text: string): number {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return Number.NaN;
  return Number(cleaned);
}
