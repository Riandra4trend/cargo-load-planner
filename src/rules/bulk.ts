/**
 * Bulk material predicates shared by the rules engine (checkPlan, validateMove) and the packer:
 * which units are bulk fills, the per-compartment checks (material state vs tank / dump body, max
 * fill, and for liquids food grade, insulation and pressure vessel) and the checks between two
 * fills of one vehicle (one fill per compartment, food contamination, hazmat).
 */
import { compartmentFill, isBulk } from '../domain/geometry';
import { maxFillPct, needsPressureTank } from '../domain/materials';
import { hazmatRule } from '../domain/settings';
import { formatMaterialVolume, formatPercent } from '../domain/units';
import type { BulkKind, Compartment, Id, ItemSpec, MaterialState, Placement, PlanSettings, StageResult, UnitSystem, Vehicle } from '../domain/types';
import { toxicFoodPair } from './geometry';

/** Surge band of an unbaffled tank compartment: liquid fills strictly between these fractions slosh when braking. */
export const SURGE_MIN = 0.2;
export const SURGE_MAX = 0.8;

/** A bulk fill in a compartment. `index` = compartment position front to rear (adjacency). */
export interface FillRef {
  id: Id;
  label: string;
  spec: ItemSpec;
  c: Compartment;
  index: number;
}

export const litresOf = (spec: ItemSpec): number => spec.material?.volumeL ?? 0;
export const stateOf = (spec: ItemSpec): MaterialState => spec.material?.state ?? 'liquid';
/** The bulk body a material needs: liquids a tank, solids a dump (tipper) body. */
export const bodyFor = (spec: ItemSpec): BulkKind => (stateOf(spec) === 'solid' ? 'tipper' : 'tank');

/** "7,700 L" for liquids, "9.5 m³" for dry bulk (plan unit system). */
export const formatFillVolume = (spec: ItemSpec, litres: number, sys: UnitSystem, digits?: number): string => formatMaterialVolume(litres, stateOf(spec), sys, digits);

/** Highest legal volume of a material in a compartment or container of `capacityL` brim (struck) litres. */
export function maxFillL(spec: ItemSpec, capacityL: number): number {
  return (capacityL * maxFillPct(spec.material?.materialId ?? '', stateOf(spec))) / 100;
}

export type FillIssue =
  | { type: 'state'; needs: BulkKind }
  | { type: 'overfill'; maxL: number; pct: number }
  | { type: 'food-grade' }
  | { type: 'insulation' }
  | { type: 'pressure'; needs: boolean };

/** Problems of one fill in one compartment, regardless of the other fills. */
export function fillIssues(v: Vehicle, c: Compartment, spec: ItemSpec): FillIssue[] {
  const bulk = v.bulk;
  if (!bulk) return [];
  const needs = bodyFor(spec);
  if (bulk.kind !== needs) return [{ type: 'state', needs }];
  const out: FillIssue[] = [];
  const maxL = maxFillL(spec, c.capacityL);
  if (litresOf(spec) > maxL + 1e-6) out.push({ type: 'overfill', maxL, pct: maxFillPct(spec.material?.materialId ?? '', stateOf(spec)) });
  if (bulk.kind !== 'tank') return out;
  if (spec.isFood && !bulk.foodGrade) out.push({ type: 'food-grade' });
  if (spec.temp !== 'ambient' && !bulk.insulated) out.push({ type: 'insulation' });
  const pressure = needsPressureTank(spec.material?.materialId ?? '');
  if (pressure !== bulk.pressurised) out.push({ type: 'pressure', needs: pressure });
  return out;
}

export type PairIssue =
  | { type: 'same' }
  | { type: 'contamination' }
  | { type: 'never' }
  | { type: 'adjacent' }
  | { type: 'toxic-food'; toxic: 'a' | 'b' };

/** Problem between two fills of one vehicle, or null. */
export function pairIssue(v: Vehicle, s: PlanSettings, a: Pick<FillRef, 'spec' | 'c' | 'index'>, b: Pick<FillRef, 'spec' | 'c' | 'index'>): PairIssue | null {
  if (a.c.id === b.c.id) return { type: 'same' };
  if (v.bulk?.kind === 'tank' && v.bulk.foodGrade && a.spec.isFood !== b.spec.isFood) return { type: 'contamination' };
  if (a.spec.hazmat && b.spec.hazmat) {
    const rule = hazmatRule(s, a.spec.hazmat.hazClass, b.spec.hazmat.hazClass);
    if (rule === 'never') return { type: 'never' };
    if (rule === 'separate' && Math.abs(a.index - b.index) === 1) return { type: 'adjacent' };
  }
  const toxic = toxicFoodPair(a.spec, b.spec);
  return toxic ? { type: 'toxic-food', toxic } : null;
}

/** "Diesel (solar) 7,900 L", "Sand (dry) 17.0 m³" */
export function fillName(f: Pick<FillRef, 'label' | 'spec'>, sys: UnitSystem): string {
  return `${f.label} ${formatFillVolume(f.spec, litresOf(f.spec), sys)}`;
}

/** "max 7,760 L (97 % of 8,000 L)" for tanks, "max 16.0 m³ (level with the sides)" for dump bodies. */
function maxText(issue: { maxL: number; pct: number }, spec: ItemSpec, c: Compartment, sys: UnitSystem): string {
  const max = formatFillVolume(spec, issue.maxL, sys);
  return stateOf(spec) === 'solid' ? `max ${max} (level with the sides)` : `max ${max} (${formatPercent(issue.pct / 100)} of ${formatFillVolume(spec, c.capacityL, sys)})`;
}

const where = (spec: ItemSpec, c: Compartment): string => (stateOf(spec) === 'solid' ? 'the dump body' : c.label);

/** Message for a single-fill issue, naming the fill. */
export function fillIssueMessage(issue: FillIssue, f: Pick<FillRef, 'label' | 'spec' | 'c'>, v: Vehicle, sys: UnitSystem): string {
  switch (issue.type) {
    case 'state':
      return issue.needs === 'tipper' ? `${f.label} needs a dump truck body` : `${f.label} can't go in a dump body`;
    case 'overfill':
      return `${fillName(f, sys)} overfills ${where(f.spec, f.c)}: ${maxText(issue, f.spec, f.c, sys)}`;
    case 'food-grade':
      return `${f.label} is a foodstuff: ${v.name} does not have a food-grade tank`;
    case 'insulation':
      return `${f.label} is ${f.spec.temp}: it needs an insulated tank`;
    case 'pressure':
      return issue.needs ? `${f.label} needs a pressurised tank` : `${f.label} cannot go into a pressurised tank`;
  }
}

/** Message for a single-fill issue, phrased for the fill being moved (validateMove reasons). */
export function fillIssueReason(issue: FillIssue, spec: ItemSpec, c: Compartment, sys: UnitSystem): string {
  switch (issue.type) {
    case 'state':
      return issue.needs === 'tipper' ? 'Needs a dump truck body' : "A liquid can't go in a dump body";
    case 'overfill':
      return `${formatFillVolume(spec, litresOf(spec), sys)} overfills ${where(spec, c)}: ${maxText(issue, spec, c, sys)}`;
    case 'food-grade':
      return 'Needs a food-grade tank';
    case 'insulation':
      return 'Needs an insulated tank';
    case 'pressure':
      return issue.needs ? 'Needs a pressurised tank' : 'A pressurised tank only carries liquefied gas';
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
      return `${a.label} and ${b.label} must not travel in one vehicle (hazmat classes ${a.spec.hazmat?.hazClass} / ${b.spec.hazmat?.hazClass})`;
    case 'adjacent':
      return `${a.label} (${a.c.label}) and ${b.label} (${b.c.label}) must not be in adjacent compartments (hazmat classes ${a.spec.hazmat?.hazClass} / ${b.spec.hazmat?.hazClass})`;
    case 'toxic-food': {
      const [toxic, food] = issue.toxic === 'a' ? [a, b] : [b, a];
      return `${toxic.label} (class ${toxic.spec.hazmat?.hazClass}) and food ${food.label} must not share a vehicle`;
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
      return issue.toxic === 'a' ? `Must not share a vehicle with food ${b.label}` : `Must not share a vehicle with toxic ${b.label}`;
  }
}

/** Liquid in an unbaffled tank compartment filled inside the surge band (dry bulk never surges). */
export function surges(v: Vehicle, c: Compartment, spec: ItemSpec): boolean {
  if (v.bulk?.kind !== 'tank' || v.bulk.baffled || stateOf(spec) !== 'liquid') return false;
  const f = compartmentFill(spec, c);
  return f > SURGE_MIN + 1e-9 && f < SURGE_MAX - 1e-9;
}

/** The fills of a placement map that sit in valid compartments of `v` (compartment order). */
export function fillsOf(
  v: Vehicle,
  placements: Readonly<Record<Id, { vehicleId: Id; compartmentId?: Id }>>,
  units: ReadonlyMap<Id, { spec: ItemSpec }>,
  labels: ReadonlyMap<Id, string>,
): FillRef[] {
  const comps = v.bulk?.compartments ?? [];
  const out: FillRef[] = [];
  for (const [id, p] of Object.entries(placements)) {
    if (p.vehicleId !== v.id) continue;
    const u = units.get(id);
    if (!u || !isBulk(u.spec)) continue;
    const index = comps.findIndex((c) => c.id === p.compartmentId);
    if (index >= 0) out.push({ id, label: labels.get(id) ?? u.spec.name, spec: u.spec, c: comps[index], index });
  }
  return out.sort((a, b) => a.index - b.index || (a.id < b.id ? -1 : 1));
}

/**
 * Placements after putting a fill into a compartment, with the store's swap semantics: a fill
 * already there moves to the mover's old compartment on the same vehicle, else it is unloaded.
 */
export function withCompartment(placements: Readonly<Record<Id, Placement>>, unitId: Id, v: Vehicle, c: Compartment): Record<Id, Placement> {
  const next: Record<Id, Placement> = { ...placements };
  const prev = placements[unitId];
  const occupant = Object.values(placements).find((p) => p.unitId !== unitId && p.vehicleId === v.id && p.compartmentId === c.id);
  if (occupant) {
    const back = prev?.vehicleId === v.id ? v.bulk?.compartments.find((x) => x.id === prev.compartmentId) : undefined;
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
