/**
 * Shared geometric and handling predicates. Both the rules engine (checkPlan, validateMove) and the
 * packer use exactly these functions, so the optimiser can never disagree with the checks.
 */
import { allowedOrientations, footprintOverlap, type Box } from '../domain/geometry';
import { hazmatRule } from '../domain/settings';
import { formatLength, formatNumber, formatWeight, fromKg, weightUnit } from '../domain/units';
import type { CargoUnit, ItemSpec, Orientation, PlanSettings, TempClass, TempZone, UnitSystem, Vec3, Vehicle, ViolationKind } from '../domain/types';

/** Vertical gap within which a unit counts as resting on another, metres. */
const CONTACT_TOL = 0.02;
/** Footprint overlap below this area does not count as contact, m². */
const AREA_EPS = 1e-6;
/** Numerical slack for "<=" comparisons against limits, metres. */
const EPS = 1e-6;

/** "17,723 / 15,422 kg" (or lb) in the plan's unit system. */
export function formatWeightRatio(kg: number, limitKg: number, sys: UnitSystem): string {
  return `${formatNumber(fromKg(kg, weightUnit(sys)))} / ${formatWeight(limitKg, sys)}`;
}

/**
 * Receives one failed hard check. The message is built lazily (only when someone reads it) and is
 * phrased for the unit being checked ("Overlaps Press die set, crated"); `others` are indices of
 * the other units involved. Return true to stop checking.
 */
export type Fail = (kind: ViolationKind, message: () => string, others?: readonly number[]) => boolean;

/** Vehicles that can only be loaded and unloaded through the rear doors. */
export function rearOnly(v: Vehicle): boolean {
  return !v.access.includes('side') && !v.access.includes('top');
}

/** Highest allowed top of any unit: cargo height minus reefer airflow gap and ceiling clearance. */
export function usableHeight(v: Vehicle, s: PlanSettings): number {
  return v.cargo.h - v.airflowTopGap - s.ceilingClearance;
}

function outsideCargo(b: Box, v: Vehicle, tol: number): boolean {
  return b.min.x < -tol || b.min.y < -tol || b.min.z < -tol || b.max.x > v.cargo.l + tol || b.max.y > v.cargo.w + tol || b.max.z > v.cargo.h + tol;
}

export function aboveCeiling(b: Box, v: Vehicle, s: PlanSettings): boolean {
  return b.max.z > usableHeight(v, s) + EPS;
}

/** Cross-section (placed y-size x z-size) passes the door. Only rear-only vehicles are restricted. */
export function fitsDoor(size: Vec3, v: Vehicle): boolean {
  return !rearOnly(v) || (size.y <= v.door.w + EPS && size.z <= v.door.h + EPS);
}

const intervalCache = new WeakMap<readonly TempZone[], Partial<Record<TempClass, [number, number][]>>>();

/** Merged x-intervals of the vehicle's zones of one temperature class (memoised per zones array). */
function zoneIntervals(v: Vehicle, temp: TempClass): readonly [number, number][] {
  let byTemp = intervalCache.get(v.zones);
  if (!byTemp) {
    byTemp = {};
    intervalCache.set(v.zones, byTemp);
  }
  const cached = byTemp[temp];
  if (cached) return cached;
  const zones = v.zones.filter((z) => z.temp === temp).sort((a, b) => a.fromX - b.fromX);
  const out: [number, number][] = [];
  for (const z of zones) {
    const last = out[out.length - 1];
    if (last && z.fromX <= last[1] + EPS) last[1] = Math.max(last[1], z.toX);
    else out.push([z.fromX, z.toX]);
  }
  byTemp[temp] = out;
  return out;
}

/** Temperature rule: non-temperature-controlled vehicles carry ambient goods only; reefers need a zone of the unit's class around its x-range. */
function fitsTemperature(v: Vehicle, temp: TempClass, minX: number, maxX: number, tol: number): boolean {
  if (!v.tempControlled) return temp === 'ambient';
  return zoneIntervals(v, temp).some(([from, to]) => minX >= from - tol && maxX <= to + tol);
}

/** Unit-local hard checks (rotation, bounds, ceiling, door, temperature). Returns true when `fail` asked to stop. */
export function localCheck(spec: ItemSpec, orient: Orientation, box: Box, v: Vehicle, s: PlanSettings, fail: Fail): boolean {
  const tol = s.overlapTolerance;
  const sys = s.units;
  if (!allowedOrientations(spec).includes(orient) && fail('rotation', () => 'Orientation not allowed for this item')) return true;
  if (outsideCargo(box, v, tol)) {
    if (fail('bounds', () => 'Outside the cargo space')) return true;
  } else if (aboveCeiling(box, v, s) && fail('ceiling', () => `Less than ${formatLength(v.airflowTopGap + s.ceilingClearance, sys)} below the ceiling`)) {
    return true;
  }
  const size = { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z };
  if (!fitsDoor(size, v) && fail('door', () => `Does not fit through the ${formatLength(v.door.w, sys)} × ${formatLength(v.door.h, sys)} door in this orientation`)) return true;
  if (
    !fitsTemperature(v, spec.temp, box.min.x, box.max.x, tol) &&
    fail('temperature', () => (v.tempControlled ? `Outside a ${spec.temp} zone` : `${spec.temp === 'frozen' ? 'Frozen' : 'Chilled'} goods need a temperature-controlled vehicle`))
  ) {
    return true;
  }
  return false;
}

/** Shortest distance between two boxes (0 when they touch or overlap), metres. */
export function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, b.min.x - a.max.x, a.min.x - b.max.x);
  const dy = Math.max(0, b.min.y - a.max.y, a.min.y - b.max.y);
  const dz = Math.max(0, b.min.z - a.max.z, a.min.z - b.max.z);
  return Math.hypot(dx, dy, dz);
}

/** `top` rests on `bottom`: bottom's top face is within CONTACT_TOL of top's base and their footprints overlap. */
export function restsOn(top: Box, bottom: Box): boolean {
  return bottom.min.z < top.min.z && Math.abs(top.min.z - bottom.max.z) <= CONTACT_TOL && footprintOverlap(top, bottom) > AREA_EPS;
}

/** A box whose base is above the overlap tolerance must be supported by other units. */
export function needsSupport(box: Box, tol: number): boolean {
  return box.min.z > tol;
}

export interface SupportEval {
  /** Supported fraction of the base (0..1). */
  fraction: number;
  /** Centre of gravity (x, y) inside the bounding rectangle of the supporting overlap regions. */
  cogInside: boolean;
}

/** Support of a box by the boxes it rests on. */
export function evaluateSupport(box: Box, cog: Vec3, supporters: readonly Box[]): SupportEval {
  const base = (box.max.x - box.min.x) * (box.max.y - box.min.y);
  let area = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of supporters) {
    const a = footprintOverlap(box, s);
    if (a <= AREA_EPS) continue;
    area += a;
    x0 = Math.min(x0, Math.max(box.min.x, s.min.x));
    y0 = Math.min(y0, Math.max(box.min.y, s.min.y));
    x1 = Math.max(x1, Math.min(box.max.x, s.max.x));
    y1 = Math.max(y1, Math.min(box.max.y, s.max.y));
  }
  return {
    fraction: base > 0 ? area / base : 0,
    cogInside: area > 0 && cog.x >= x0 - EPS && cog.x <= x1 + EPS && cog.y >= y0 - EPS && cog.y <= y1 + EPS,
  };
}

/**
 * Rear-door LIFO blocking: `a` sits between `b` and the rear doors (a starts at or behind b's rear
 * face) and their y- and z-intervals overlap by more than `tol`, so `b` cannot be unloaded first.
 */
export function blocksRear(a: Box, b: Box, tol: number): boolean {
  return (
    a.min.x >= b.max.x - tol &&
    Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y) > tol &&
    Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z) > tol
  );
}

/** Units without a known stop (stop deleted) take no part in LIFO checks. */
export function hasStop(u: CargoUnit): boolean {
  return u.stopSeq < Number.MAX_SAFE_INTEGER;
}

export const isHazmatRelevant = (spec: ItemSpec): boolean => !!spec.hazmat || spec.isFood;

const TOXIC_CLASSES: Record<string, true> = { '6.1': true, '6.2': true };

/** Which of two units is toxic or infectious (classes 6.1/6.2) while the other is food, or null. */
export function toxicFoodPair(a: ItemSpec, b: ItemSpec): 'a' | 'b' | null {
  if (a.hazmat && TOXIC_CLASSES[a.hazmat.hazClass] && b.isFood) return 'a';
  if (b.hazmat && TOXIC_CLASSES[b.hazmat.hazClass] && a.isFood) return 'b';
  return null;
}

export type HazmatIssue = { rule: 'never' } | { rule: 'separate'; required: number } | { rule: 'food'; required: number; toxic: 'a' | 'b' };

/** Segregation issue between two units at a given distance, or null when they may travel like this. */
export function hazmatIssue(s: PlanSettings, a: ItemSpec, b: ItemSpec, distance: number): HazmatIssue | null {
  if (a.hazmat && b.hazmat) {
    const rule = hazmatRule(s, a.hazmat.hazClass, b.hazmat.hazClass);
    if (rule === 'never') return { rule: 'never' };
    if (rule === 'separate' && distance < s.hazmatSeparationM - EPS) return { rule: 'separate', required: s.hazmatSeparationM };
  }
  if (distance < s.foodSeparationM - EPS) {
    const toxic = toxicFoodPair(a, b);
    if (toxic) return { rule: 'food', required: s.foodSeparationM, toxic };
  }
  return null;
}

/** Message for a hazmat issue, phrased for unit `a` about `bLabel`. */
export function hazmatMessage(issue: HazmatIssue, a: ItemSpec, b: ItemSpec, bLabel: string, s: PlanSettings): string {
  if (issue.rule === 'never') return `Must not travel with ${bLabel} (hazmat classes ${a.hazmat?.hazClass} / ${b.hazmat?.hazClass})`;
  if (issue.rule === 'separate') return `Must be at least ${formatLength(issue.required, s.units)} from ${bLabel} (hazmat classes ${a.hazmat?.hazClass} / ${b.hazmat?.hazClass})`;
  return issue.toxic === 'a'
    ? `Must be at least ${formatLength(issue.required, s.units)} from food ${bLabel}`
    : `Must be at least ${formatLength(issue.required, s.units)} from toxic ${bLabel} (class ${b.hazmat?.hazClass})`;
}
