/** Tanker and liquid violations of checkPlan: 'tank' (hard), 'surge' (soft) and compartment fix suggestions. */
import { PACKAGING_PRESETS } from '../data/packaging';
import { bulkCog, compartmentFill, compartmentOf, isBulkLiquid } from '../domain/geometry';
import { formatLitres, formatPercent } from '../domain/units';
import type { Id, Plan, StageResult, TankCompartment, Vehicle, Violation } from '../domain/types';
import { computeStages, type StagePoint } from '../physics';
import { planIndex } from './context';
import {
  fillIssueMessage,
  fillIssues,
  fillsOf,
  litresOf,
  maxFillL,
  pairIssue,
  pairIssueMessage,
  stageExcessKg,
  surges,
  SURGE_MAX,
  withCompartment,
  type FillRef,
} from './tank';
import { validateMove } from './validateMove';

type Fix = NonNullable<Violation['fix']>;

const pairKey = (a: Id, b: Id): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Hard 'tank' violations of one vehicle: bulk fills outside tanker compartments, packaged units in
 * a tanker, compartment checks, checks between fills and (with `containers`) overfilled packaged
 * liquid containers.
 */
export function tankHardViolations(plan: Plan, v: Vehicle, containers: boolean, out: Violation[]): void {
  const { units, labels } = planIndex(plan);
  const s = plan.settings;
  const sys = s.units;
  const hard = (id: string, message: string, unitIds: Id[], fix?: Fix) =>
    out.push({ id, kind: 'tank', severity: 'error', hard: true, message, vehicleId: v.id, unitIds, ...(fix ? { fix } : {}) });

  for (const p of Object.values(plan.placements)) {
    if (p.vehicleId !== v.id) continue;
    const u = units.get(p.unitId);
    if (!u) continue;
    const label = labels.get(u.id) ?? u.spec.name;
    if (isBulkLiquid(u.spec)) {
      if (!v.tank || !compartmentOf(v, p.compartmentId)) hard(`tank:bulk:${u.id}`, `${label}: bulk liquid goes into a tanker compartment`, [u.id]);
    } else if (v.tank) {
      hard(`tank:packaged:${u.id}`, `${label}: a tanker only carries bulk liquid`, [u.id]);
    } else if (containers && u.spec.liquid) {
      const capacityL = u.spec.liquid.containerCapacityL ?? PACKAGING_PRESETS[u.spec.packaging]?.capacityL;
      const maxL = capacityL === undefined ? Infinity : maxFillL(u.spec, capacityL);
      if (capacityL !== undefined && litresOf(u.spec) > maxL + 1e-6) {
        hard(
          `tank:container:${u.id}`,
          `${label}: ${formatLitres(litresOf(u.spec), sys)} overfills its container: max ${formatLitres(maxL, sys)} (${formatPercent(maxL / capacityL)} of ${formatLitres(capacityL, sys, 0)})`,
          [u.id],
        );
      }
    }
  }
  if (!v.tank) return;

  const fills = fillsOf(v, plan.placements, units, labels);
  for (const f of fills) {
    for (const issue of fillIssues(v, f.c, f.spec)) {
      const fix = issue.type === 'overfill' ? overfillFix(plan, v, f) : undefined;
      hard(`tank:${issue.type}:${f.id}`, fillIssueMessage(issue, f, v, sys), [f.id], fix);
    }
  }
  for (let i = 0; i < fills.length; i++) {
    for (let j = i + 1; j < fills.length; j++) {
      const issue = pairIssue(v, s, fills[i], fills[j]);
      if (issue) hard(`tank:${issue.type}:${pairKey(fills[i].id, fills[j].id)}`, pairIssueMessage(issue, fills[i], fills[j]), [fills[i].id, fills[j].id]);
    }
  }
}

/** Soft 'surge' warnings for partially filled unbaffled compartments. */
export function surgeViolations(plan: Plan, v: Vehicle, out: Violation[]): void {
  if (!v.tank || v.tank.baffled) return;
  const { units, labels } = planIndex(plan);
  for (const f of fillsOf(v, plan.placements, units, labels)) {
    if (!surges(v, f.c, f.spec)) continue;
    const vio: Violation = {
      id: `surge:${f.id}`,
      kind: 'surge',
      severity: 'warning',
      hard: false,
      message: `${f.c.label} is ${formatPercent(compartmentFill(f.spec, f.c))} full: liquid surge when braking; fill it above ${formatPercent(SURGE_MAX)} or use a smaller compartment`,
      vehicleId: v.id,
      unitIds: [f.id],
    };
    const fix = surgeFix(plan, v, f);
    if (fix) vio.fix = fix;
    out.push(vio);
  }
}

const freeCompartments = (plan: Plan, v: Vehicle): TankCompartment[] =>
  (v.tank?.compartments ?? []).filter((c) => !Object.values(plan.placements).some((p) => p.vehicleId === v.id && p.compartmentId === c.id));

function moveTo(plan: Plan, v: Vehicle, f: FillRef, c: TankCompartment): Fix | undefined {
  const action = { type: 'compartment' as const, unitId: f.id, vehicleId: v.id, compartmentId: c.id };
  if (!validateMove(plan, { unitId: f.id, vehicleId: v.id, compartmentId: c.id, pos: { x: c.fromX, y: 0, z: 0 }, orient: 0 }).ok) return undefined;
  return { label: `Move ${f.label} to ${c.label}`, action };
}

/** Smallest free compartment that holds the fill legally. */
function overfillFix(plan: Plan, v: Vehicle, f: FillRef): Fix | undefined {
  const options = freeCompartments(plan, v)
    .filter((c) => litresOf(f.spec) <= maxFillL(f.spec, c.capacityL) + 1e-6)
    .sort((a, b) => a.capacityL - b.capacityL);
  for (const c of options) {
    const fix = moveTo(plan, v, f, c);
    if (fix) return fix;
  }
  return undefined;
}

/** Free compartment where the fill is at least SURGE_MAX full and within its max fill (fullest first). */
function surgeFix(plan: Plan, v: Vehicle, f: FillRef): Fix | undefined {
  const options = freeCompartments(plan, v)
    .filter((c) => compartmentFill(f.spec, c) >= SURGE_MAX - 1e-9 && litresOf(f.spec) <= maxFillL(f.spec, c.capacityL) + 1e-6)
    .sort((a, b) => a.capacityL - b.capacityL);
  for (const c of options) {
    const fix = moveTo(plan, v, f, c);
    if (fix) return fix;
  }
  return undefined;
}

/**
 * Tanker axle fixes: the single compartment move or swap of one of the responsible fills that
 * clears every axle problem at every stage (or, failing that, leaves the least excess while
 * clearing the violation it is attached to).
 */
export function tankAxleFixes(plan: Plan, v: Vehicle, points: readonly StagePoint[], vios: readonly Violation[]): void {
  const tank = v.tank;
  if (!tank) return;
  const { units, labels } = planIndex(plan);
  const fills = fillsOf(v, plan.placements, units, labels);
  const responsible = new Set(vios.flatMap((x) => x.unitIds));
  const base = stageExcessKg(v, computeStages(v, plan.stops, points, plan.settings.nearLimit));
  let best: { fix: Fix; excess: number; stages: StageResult[] } | null = null;
  for (const f of fills) {
    if (!responsible.has(f.id)) continue;
    for (const c of tank.compartments) {
      if (c.id === f.c.id) continue;
      if (!validateMove(plan, { unitId: f.id, vehicleId: v.id, compartmentId: c.id, pos: { x: c.fromX, y: 0, z: 0 }, orient: 0 }).ok) continue;
      const after = withCompartment(plan.placements, f.id, v, c);
      const moved = new Map(fillsOf(v, after, units, labels).map((x) => [x.id, x]));
      const pts = points.map((p) => {
        const m = moved.get(p.id);
        if (!m) return p;
        const g = bulkCog(v, m.c, m.spec);
        return { ...p, x: g.x, y: g.y, z: g.z };
      });
      const stages = computeStages(v, plan.stops, pts, plan.settings.nearLimit);
      const excess = stageExcessKg(v, stages);
      if (excess >= base - 0.5 || (best && excess >= best.excess - 1e-6)) continue;
      const occupant = fills.find((x) => x.c.id === c.id);
      const label = occupant ? `Swap ${f.label} (${f.c.label}) with ${occupant.label} (${c.label})` : `Move ${f.label} to ${c.label}`;
      best = { fix: { label, action: { type: 'compartment', unitId: f.id, vehicleId: v.id, compartmentId: c.id } }, excess, stages };
    }
  }
  if (!best) return;
  const result = best;
  for (const vio of vios) {
    const st = result.stages.find((x) => x.stage === vio.stage);
    const group = vio.id.split(':')[2];
    const a = st?.axle.axles.find((x) => x.id === group);
    if (a && a.status !== 'over' && a.status !== 'under') vio.fix = result.fix;
  }
}
