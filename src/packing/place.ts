import type { Id, Placement, Plan } from '../domain/types';
import { computeStages, loadShares, type StagePoint } from '../physics';
import { Arrangement } from '../rules/arrangement';
import { planIndex, vehicleArrangement } from '../rules/context';
import { searchPlacement } from '../rules/placement';
import { usableOrientations } from './construct';

/** Score units per LIFO conflict and per overloaded kg (front-most scoring adds 10 per metre). */
const LIFO_PENALTY = 1000;
const OVERLOAD_PENALTY = 100;

/**
 * Best legal position for one unit in a vehicle without moving other units, or null. Candidates
 * are the extreme points of the current load; ranking prefers front-most, low, left and flush
 * spots without LIFO conflicts and without axle overloads at any stage the unit is aboard.
 */
export function findPlacementFor(plan: Plan, unitId: Id, vehicleId: Id): Placement | null {
  const { units, vehicles } = planIndex(plan);
  const unit = units.get(unitId);
  const v = vehicles.get(vehicleId);
  if (!unit || !v) return null;
  const orients = usableOrientations(unit, v, plan);
  if (!orients.length) return null;
  const arr = Arrangement.build(v, plan.settings, vehicleArrangement(plan, v, unitId).solids);
  arr.enableAnchors(0, [0, ...v.zones.map((z) => z.fromX).filter((x) => x > 1e-6 && x < v.cargo.l - 1e-6)]);

  const points: StagePoint[] = arr.solids.map((s) => ({ id: s.id, x: s.cog.x, y: s.cog.y, z: s.cog.z, kg: s.kg, stopSeq: s.unit.stopSeq }));
  const stages = computeStages(v, plan.stops, points, plan.settings.nearLimit).filter((st) => st.stage === 0 || unit.stopSeq > st.stage);
  const kg = unit.spec.weightKg;
  const overload = (x: number): number => {
    const sh = loadShares(v, x);
    let excess = 0;
    for (const st of stages) {
      const gross = st.axle.grossKg + kg;
      st.axle.axles.forEach((a, g) => {
        const load = a.kg + kg * sh[g];
        const minKg = (a.minKg / st.axle.grossKg) * gross;
        excess += Math.max(0, load - a.maxKg - 0.5) + Math.max(0, minKg - load - 0.5);
      });
    }
    return excess;
  };

  const width = v.cargo.w;
  const found = searchPlacement(arr, unit, {
    orients,
    score: (c) =>
      10 * c.box.min.x + 3 * c.box.min.z + c.box.min.y / width - (c.flush ? 0.5 : 0) + LIFO_PENALTY * c.lifo.length + OVERLOAD_PENALTY * overload(c.cog.x),
    bound: (a) => 10 * a.x - 0.5,
  });
  return found ? { unitId, vehicleId, pos: found.cand.pos, orient: found.cand.orient } : null;
}
