import type { HazmatRule, PlanSettings } from './types';

/** Hazmat classes offered in the editor and the compatibility matrix. */
export const HAZMAT_CLASSES = ['1', '2.1', '2.2', '2.3', '3', '4.1', '4.2', '4.3', '5.1', '5.2', '6.1', '6.2', '7', '8', '9'];

export const HAZMAT_CLASS_NAMES: Record<string, string> = {
  '1': 'Explosives',
  '2.1': 'Flammable gas',
  '2.2': 'Non-flammable gas',
  '2.3': 'Toxic gas',
  '3': 'Flammable liquid',
  '4.1': 'Flammable solid',
  '4.2': 'Spontaneously combustible',
  '4.3': 'Dangerous when wet',
  '5.1': 'Oxidizer',
  '5.2': 'Organic peroxide',
  '6.1': 'Toxic',
  '6.2': 'Infectious',
  '7': 'Radioactive',
  '8': 'Corrosive',
  '9': 'Miscellaneous',
};

/**
 * Illustrative default segregation pairs, loosely based on ADR 7.5.2 and 49 CFR 177.848.
 * NOT a legal reference: users must verify against the regulations that apply to them.
 */
const DEFAULT_PAIRS: [string, string, HazmatRule][] = [
  ['3', '5.1', 'separate'],
  ['3', '5.2', 'separate'],
  ['2.1', '5.1', 'separate'],
  ['2.1', '5.2', 'separate'],
  ['4.1', '5.1', 'separate'],
  ['4.2', '5.1', 'separate'],
  ['4.3', '5.1', 'separate'],
  ['4.3', '8', 'separate'],
  ['4.1', '8', 'separate'],
  ['4.2', '8', 'separate'],
  ['5.1', '8', 'separate'],
  ['5.2', '8', 'separate'],
  ['2.3', '3', 'never'],
  ['2.3', '4.1', 'never'],
  ['2.3', '4.2', 'never'],
  ['2.3', '4.3', 'never'],
  ['2.3', '5.1', 'never'],
  ['2.3', '8', 'never'],
  ...['2.1', '2.2', '2.3', '3', '4.1', '4.2', '4.3', '5.1', '5.2', '6.1', '6.2', '7', '8', '9'].map(
    (c) => ['1', c, 'never'] as [string, string, HazmatRule],
  ),
];

export function buildHazmatMatrix(pairs: [string, string, HazmatRule][] = DEFAULT_PAIRS): Record<string, Record<string, HazmatRule>> {
  const m: Record<string, Record<string, HazmatRule>> = {};
  for (const c of HAZMAT_CLASSES) m[c] = {};
  for (const [a, b, rule] of pairs) {
    m[a][b] = rule;
    m[b][a] = rule;
  }
  return m;
}

/** Rule between two hazmat classes (symmetric); missing pairs are 'ok'. */
export function hazmatRule(settings: PlanSettings, a: string, b: string): HazmatRule {
  return settings.hazmatMatrix[a]?.[b] ?? settings.hazmatMatrix[b]?.[a] ?? 'ok';
}

export function defaultSettings(): PlanSettings {
  return {
    units: 'metric',
    supportRatio: 0.75,
    ceilingClearance: 0.05,
    overlapTolerance: 0.01,
    nearLimit: 0.9,
    forkliftCapacityKg: 2500,
    snapGrid: 0.05,
    hazmatSeparationM: 1.0,
    foodSeparationM: 1.0,
    hazmatMatrix: buildHazmatMatrix(),
    tempRanges: {
      ambient: { min: 15, max: 25 },
      chilled: { min: 0, max: 4 },
      frozen: { min: -25, max: -18 },
    },
    optimiserTimeMs: 3000,
    seed: 42,
    fuelPricePerL: 1.05,
    currency: 'USD',
    co2KgPerL: 2.68,
    avgSpeedKmh: 55,
    stopMinutes: 25,
    idleMinutesPerStop: 10,
  };
}

export const DISCLAIMER =
  'Planning aid only. Limits are editable defaults; verify against local regulations, vehicle documents and a weighbridge. Secure loads per EN 12195-1 / FMCSA 49 CFR 393.';
