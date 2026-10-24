import type { Dims, MaterialState, UnitSystem } from './types';

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

export const KM_PER_MI = 1.609344;
export const L_PER_US_GAL = 3.785411784;
/** 100 · L_PER_US_GAL / KM_PER_MI ≈ 235.215: L/100 km × mpg = this constant. */
const L100_MPG = (100 * L_PER_US_GAL) / KM_PER_MI;

/** Converts L/100 km to US mpg; the same formula converts mpg back to L/100 km. */
export const lPer100kmToMpg = (value: number): number => L100_MPG / value;

/** "152 km" or "94 mi". */
export function formatDistance(km: number, sys: UnitSystem, digits = 0): string {
  return sys === 'metric' ? `${formatNumber(km, digits)} km` : `${formatNumber(km / KM_PER_MI, digits)} mi`;
}

/** Liquid volume split for KPI cards: metric ["58.4", "L"], imperial ["15.4", "gal"] (US gallons). */
export function litreParts(litres: number, sys: UnitSystem, digits = 1): [string, string] {
  return sys === 'metric' ? [formatNumber(litres, digits), 'L'] : [formatNumber(litres / L_PER_US_GAL, digits), 'gal'];
}

/** Fuel or liquid cargo volume: "58.4 L" or "15.4 gal". */
export function formatLitres(litres: number, sys: UnitSystem, digits = 1): string {
  return litreParts(litres, sys, digits).join(' ');
}

/** US cubic yard, litres (exact). */
export const L_PER_CU_YD = 764.554857984;

/**
 * Material volume split for KPI cards: liquids in L or US gal, dry bulk in m³ or cubic yards. Without
 * `digits`, values of 100 or more show whole numbers and smaller ones one decimal.
 */
export function materialVolumeParts(litres: number, state: MaterialState, sys: UnitSystem, digits?: number): [string, string] {
  const [value, unit] =
    state === 'liquid' ? (sys === 'metric' ? [litres, 'L'] : [litres / L_PER_US_GAL, 'gal']) : sys === 'metric' ? [litres / 1000, 'm³'] : [litres / L_PER_CU_YD, 'yd³'];
  return [formatNumber(value, digits ?? (Math.abs(value) >= 100 ? 0 : 1)), unit];
}

/** "7,700 L" / "2,034 gal" for liquids, "9.5 m³" / "12.4 yd³" for dry bulk. */
export function formatMaterialVolume(litres: number, state: MaterialState, sys: UnitSystem, digits?: number): string {
  return materialVolumeParts(litres, state, sys, digits).join(' ');
}

/** Density: liquids "0.840 kg/L" / "7.01 lb/gal", dry bulk "1.60 t/m³" / "99.9 lb/ft³". */
export function formatMaterialDensity(kgPerL: number, state: MaterialState, sys: UnitSystem): string {
  if (state === 'liquid') return sys === 'metric' ? `${formatNumber(kgPerL, 3)} kg/L` : `${formatNumber(kgToLb(kgPerL) * L_PER_US_GAL, 2)} lb/gal`;
  return sys === 'metric' ? `${formatNumber(kgPerL, 2)} t/m³` : `${formatNumber(kgToLb(kgPerL * 1000) * M_PER_FT ** 3, 1)} lb/ft³`;
}

/** Driving consumption: metric "38.4 L/100 km", imperial "6.1 mpg" (US gallons). */
export function formatConsumption(lPer100km: number, sys: UnitSystem): string {
  if (!(lPer100km > 0)) return '-';
  return sys === 'metric' ? `${formatNumber(lPer100km, 1)} L/100 km` : `${formatNumber(lPer100kmToMpg(lPer100km), 1)} mpg`;
}

/** Money in an ISO 4217 currency ("$61.32", "€1,250"); an unknown code falls back to "XYZ 12.34". */
export function formatMoney(amount: number, currency: string): string {
  const digits = Math.abs(amount) >= 1000 ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.trim().toUpperCase(), minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${currency} ${formatNumber(amount, digits)}`;
  }
}

/** Parses a user-typed number, accepting "," as decimal separator. Returns NaN when invalid. */
export function parseNumber(text: string): number {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return Number.NaN;
  return Number(cleaned);
}
