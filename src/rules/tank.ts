/**
 * Tanker predicates shared by the rules engine (checkPlan, validateMove) and the packer: which units
 * are bulk fills, the per-compartment checks (max fill, food grade, insulation, pressure vessel) and
 * the checks between two fills of one tanker (one fill per compartment, food contamination, hazmat).
 */
import { compartmentFill, isBulkLiquid } from '../domain/geometry';
import { maxFillPct, needsPressureTank } from '../domain/liquids';
import { hazmatRule } from '../domain/settings';
import { formatLitres, formatPercent } from '../domain/units';
import type { Id, ItemSpec, Placement, PlanSettings, StageResult, TankCompartment, UnitSystem, Vehicle } from '../domain/types';
import { toxicFoodPair } from './geometry';

/** Surge band of an unbaffled compartment: fills strictly between these fractions slosh when braking. */
export const SURGE_MIN = 0.2;
export const SURGE_MAX = 0.8;

/** A bulk fill in a tanker compartment. `index` = compartment position front to rear (adjacency). */
export interface FillRef {
  id: Id;
  label: string;
  spec: ItemSpec;
  c: TankCompartment;
  index: number;
}

export const litresOf = (spec: ItemSpec): number => spec.liquid?.volumeL ?? 0;

/** Highest legal volume of a liquid in a compartment or container of `capacityL` brim litres. */
export function maxFillL(spec: ItemSpec, capacityL: number): number {
  return (capacityL * maxFillPct(spec.liquid?.liquidId ?? '')) / 100;
}

export type FillIssue =
  | { type: 'overfill'; maxL: number; pct: number }
  | { type: 'food-grade' }
  | { type: 'insulation' }
  | { type: 'pressure'; needs: boolean };

/** Problems of one fill in one compartment of a tanker, regardless of the other fills. */
export function fillIssues(v: Vehicle, c: TankCompartment, spec: ItemSpec): FillIssue[] {
  const tank = v.tank;
  if (!tank) return [];
  const out: FillIssue[] = [];
  const maxL = maxFillL(spec, c.capacityL);
  if (litresOf(spec) > maxL + 1e-6) out.push({ type: 'overfill', maxL, pct: maxFillPct(spec.liquid?.liquidId ?? '') });
  if (spec.isFood && !tank.foodGrade) out.push({ type: 'food-grade' });
  if (spec.temp !== 'ambient' && !tank.insulated) out.push({ type: 'insulation' });
  const pressure = needsPressureTank(spec.liquid?.liquidId ?? '');
  if (pressure !== tank.pressurised) out.push({ type: 'pressure', needs: pressure });
  return out;
}

export type PairIssue =
  | { type: 'same' }
  | { type: 'contamination' }
  | { type: 'never' }
  | { type: 'adjacent' }
  | { type: 'toxic-food'; toxic: 'a' | 'b' };

/** Problem between two fills of one tanker, or null. */
export function pairIssue(v: Vehicle, s: PlanSettings, a: Pick<FillRef, 'spec' | 'c' | 'index'>, b: Pick<FillRef, 'spec' | 'c' | 'index'>): PairIssue | null {
  if (a.c.id === b.c.id) return { type: 'same' };
  if (v.tank?.foodGrade && a.spec.isFood !== b.spec.isFood) return { type: 'contamination' };
  if (a.spec.hazmat && b.spec.hazmat) {
    const rule = hazmatRule(s, a.spec.hazmat.hazClass, b.spec.hazmat.hazClass);
    if (rule === 'never') return { type: 'never' };
    if (rule === 'separate' && Math.abs(a.index - b.index) === 1) return { type: 'adjacent' };
  }
  const toxic = toxicFoodPair(a.spec, b.spec);
  return toxic ? { type: 'toxic-food', toxic } : null;
}

/** "Diesel (solar) 7,900 L" */
export function fillName(f: Pick<FillRef, 'label' | 'spec'>, sys: UnitSystem): string {
  return `${f.label} ${formatLitres(litresOf(f.spec), sys, 0)}`;
}

/** Message for a single-fill issue, naming the fill. */
export function fillIssueMessage(issue: FillIssue, f: Pick<FillRef, 'label' | 'spec' | 'c'>, v: Vehicle, sys: UnitSystem): string {
  switch (issue.type) {
    case 'overfill':
      return `${fillName(f, sys)} overfills ${f.c.label}: max ${formatLitres(issue.maxL, sys, 0)} (${formatPercent(issue.pct / 100)} of ${formatLitres(f.c.capacityL, sys, 0)})`;
    case 'food-grade':
      return `${f.label} is a foodstuff: ${v.name} does not have a food-grade tank`;
    case 'insulation':
      return `${f.label} is ${f.spec.temp}: it needs an insulated tank`;
    case 'pressure':
      return issue.needs ? `${f.label} needs a pressurised tank` : `${f.label} cannot go into a pressurised tank`;
  }
}

/** Message for a pair issue, naming both fills. */
export function pairIssueMessage(issue: PairIssue, a: FillRef, b: FillRef): string {
  switch (issue.type) {
    case 'same':
      return `${a.label} and ${b.label} are both in ${a.c.label}`;
    case 'contamination': {
      const [food, other] = a.spec.isFood ? [a, b] : [b, a];
      return `Food ${food.label} and non-food ${other.label} share a food-grade tank`;
    }
    case 'never':
      return `${a.label} and ${b.label} must not travel in one tanker (hazmat classes ${a.spec.hazmat?.hazClass} / ${b.spec.hazmat?.hazClass})`;
    case 'adjacent':
      return `${a.label} (${a.c.label}) and ${b.label} (${b.c.label}) must not be in adjacent compartments (hazmat classes ${a.spec.hazmat?.hazClass} / ${b.spec.hazmat?.hazClass})`;
    case 'toxic-food': {
      const [toxic, food] = issue.toxic === 'a' ? [a, b] : [b, a];
      return `${toxic.label} (class ${toxic.spec.hazmat?.hazClass}) and food ${food.label} must not share a tanker`;
    }
  }
}

/** Message for a pair issue, phrased for `a` (validateMove reasons). */
export function pairIssueReason(issue: PairIssue, a: FillRef, b: FillRef): string {
  switch (issue.type) {
    case 'same':
      return `${a.c.label} already holds ${b.label}`;
    case 'contamination':
      return `Food and non-food liquids must not share a food-grade tank (${b.label})`;
    case 'never':
      return `Must not travel with ${b.label} (hazmat classes ${a.spec.hazmat?.hazClass} / ${b.spec.hazmat?.hazClass})`;
    case 'adjacent':
      return `Must not be next to ${b.label} in ${b.c.label} (hazmat classes ${a.spec.hazmat?.hazClass} / ${b.spec.hazmat?.hazClass})`;
    case 'toxic-food':
      return issue.toxic === 'a' ? `Must not share a tanker with food ${b.label}` : `Must not share a tanker with toxic ${b.label}`;
  }
}

/** Message for a single-fill issue, phrased for the fill being moved (validateMove reasons). */
export function fillIssueReason(issue: FillIssue, spec: ItemSpec, c: TankCompartment, sys: UnitSystem): string {
  switch (issue.type) {
    case 'overfill':
      return `${formatLitres(litresOf(spec), sys, 0)} overfills ${c.label}: max ${formatLitres(issue.maxL, sys, 0)} (${formatPercent(issue.pct / 100)} of ${formatLitres(c.capacityL, sys, 0)})`;
    case 'food-grade':
      return 'Needs a food-grade tank';
    case 'insulation':
      return 'Needs an insulated tank';
    case 'pressure':
      return issue.needs ? 'Needs a pressurised tank' : 'A pressurised tank only carries liquefied gas';
  }
}

/** Unbaffled compartment filled inside the surge band. */
export function surges(v: Vehicle, c: TankCompartment, spec: ItemSpec): boolean {
  const f = compartmentFill(spec, c);
  return !!v.tank && !v.tank.baffled && f > SURGE_MIN + 1e-9 && f < SURGE_MAX - 1e-9;
}

/** The fills of a placement map that sit in valid compartments of `v` (compartment order). */
export function fillsOf(
  v: Vehicle,
  placements: Readonly<Record<Id, { vehicleId: Id; compartmentId?: Id }>>,
  units: ReadonlyMap<Id, { spec: ItemSpec }>,
  labels: ReadonlyMap<Id, string>,
): FillRef[] {
  const comps = v.tank?.compartments ?? [];
  const out: FillRef[] = [];
  for (const [id, p] of Object.entries(placements)) {
    if (p.vehicleId !== v.id) continue;
    const u = units.get(id);
    if (!u || !isBulkLiquid(u.spec)) continue;
    const index = comps.findIndex((c) => c.id === p.compartmentId);
    if (index >= 0) out.push({ id, label: labels.get(id) ?? u.spec.name, spec: u.spec, c: comps[index], index });
  }
  return out.sort((a, b) => a.index - b.index || (a.id < b.id ? -1 : 1));
}

/**
 * Placements after putting a fill into a compartment, with the store's swap semantics: a fill
 * already there moves to the mover's old compartment on the same tanker, else it is unloaded.
 */
export function withCompartment(placements: Readonly<Record<Id, Placement>>, unitId: Id, v: Vehicle, c: TankCompartment): Record<Id, Placement> {
  const next: Record<Id, Placement> = { ...placements };
  const prev = placements[unitId];
  const occupant = Object.values(placements).find((p) => p.unitId !== unitId && p.vehicleId === v.id && p.compartmentId === c.id);
  if (occupant) {
    const back = prev?.vehicleId === v.id ? v.tank?.compartments.find((x) => x.id === prev.compartmentId) : undefined;
    if (back) next[occupant.unitId] = { ...occupant, compartmentId: back.id, pos: { x: back.fromX, y: 0, z: 0 } };
    else delete next[occupant.unitId];
  }
  next[unitId] = { unitId, vehicleId: v.id, compartmentId: c.id, pos: { x: c.fromX, y: 0, z: 0 }, orient: 0, ...(prev?.pinned ? { pinned: true } : {}) };
  return next;
}

/** Axle overload and minimum-share shortfall plus gross overload over all stages, kg (same tolerances as the statuses). */
export function stageExcessKg(v: Vehicle, stages: readonly StageResult[]): number {
  let kg = 0;
  for (const st of stages) {
    for (const a of st.axle.axles) kg += Math.max(0, a.kg - a.maxKg - 0.5) + Math.max(0, a.minKg - a.kg - 0.5);
    kg += Math.max(0, st.axle.grossKg - v.grossLimitKg - 0.5);
  }
  return kg;
}

/** Highest axle utilisation (kg / limit) over all stages. */
export function worstUtilisation(stages: readonly StageResult[]): number {
  let worst = 0;
  for (const st of stages) for (const a of st.axle.axles) worst = Math.max(worst, a.kg / a.maxKg);
  return worst;
}
