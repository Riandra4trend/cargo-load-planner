/**
 * Layout score for the optimiser (lower is better), computed with src/physics directly: unplaced
 * units, axle/gross/payload/bridge/floor overloads at every stage (with the best slider hole), LIFO
 * blocking, distance of the cargo COG from the centre of the legal COG window, lateral imbalance,
 * COG height, stack quality and, in stable mode, moved units.
 */
import type { Vehicle } from '../domain/types';
import { lbToKg } from '../domain/units';
import {
  bestSliderPosition,
  bridgeFormulaChecks,
  computeStages,
  lateralImbalance,
  loadDistributionCurve,
  peakRunningMetreLoad,
  withTrailerAxleX,
  type StagePoint,
} from '../physics';
import { samePlacement, type Layout, type Problem } from './construct';

const W_UNPLACED = 100_000;
const W_URGENT = 3;
const W_OVERLOAD_KG = 100;
const W_LIFO = 30_000;
const W_COG_M = 500;
const W_LATERAL = 2_000;
const W_LATERAL_OVER = 20_000;
const W_COG_HEIGHT_M = 10_000;
const W_STACK = 0.02;
const W_MOVED = 5_000;

export interface Score {
  total: number;
  unplaced: number;
  /** Overloaded kg summed over all limits and stages (axle max/min, gross, payload, bridge, floor). */
  overloadKg: number;
  /** Units blocking earlier stops. */
  lifo: number;
  /** Lateral or COG-height limits broken. */
  warnings: number;
  moved: number;
  /** Best slider position per vehicle (null without a slider or cargo). */
  sliders: (number | null)[];
}

/** Window centres per axle geometry (statics object), keyed by slider position, cargo weight and limits. */
const centreCache = new WeakMap<Vehicle['statics'], Map<string, number>>();

/**
 * Centre of the legal COG window (the x-range where the load distribution curve covers the cargo
 * weight) with the trailer axle at `trailerX` (null: as is); the curve's peak when no window exists.
 */
export function windowCentre(base: Vehicle, trailerX: number | null, cargoKg: number): number {
  let byKey = centreCache.get(base.statics);
  if (!byKey) {
    byKey = new Map();
    centreCache.set(base.statics, byKey);
  }
  const key = `${trailerX ?? ''}:${Math.round(cargoKg)}:${base.cargo.l}:${base.payloadKg}:${base.grossLimitKg}`;
  const cached = byKey.get(key);
  if (cached !== undefined) return cached;
  const curve = loadDistributionCurve(trailerX === null ? base : withTrailerAxleX(base, trailerX), 0.1);
  let from = Infinity;
  let to = -Infinity;
  let peak = curve[0];
  for (const p of curve) {
    if (p.maxKg >= cargoKg) {
      from = Math.min(from, p.x);
      to = Math.max(to, p.x);
    }
    if (p.maxKg > peak.maxKg) peak = p;
  }
  const centre = Number.isFinite(from) ? (from + to) / 2 : peak.x;
  byKey.set(key, centre);
  return centre;
}

export function scoreLayout(pr: Problem, layout: Layout): Score {
  const s = pr.plan.settings;
  let total = 0;
  let unplaced = 0;
  for (const i of layout.unplaced) {
    const weight = pr.units[i].priority === 'urgent' ? W_URGENT : 1;
    unplaced++;
    total += W_UNPLACED * weight;
  }
  let overloadKg = 0;
  let lifo = 0;
  let warnings = 0;
  const sliders: (number | null)[] = [];
  layout.arrs.forEach((arr, vi) => {
    let v = layout.vehicles[vi];
    if (!arr.solids.length) {
      sliders.push(null);
      return;
    }
    const points: StagePoint[] = arr.solids.map((sol) => ({ id: sol.id, x: sol.cog.x, y: sol.cog.y, z: sol.cog.z, kg: sol.kg, stopSeq: sol.unit.stopSeq }));
    let slider: number | null = null;
    if (v.statics.type === 'artic' && v.statics.slider) {
      const seqs = [...new Set(pr.plan.stops.map((st) => st.sequence))].sort((a, b) => a - b);
      const sets = [points, ...seqs.slice(0, -1).map((seq) => points.filter((p) => p.stopSeq > seq))];
      const best = bestSliderPosition(v, sets, s.nearLimit);
      if (best) {
        slider = best.x;
        v = withTrailerAxleX(v, best.x);
      }
    }
    sliders.push(slider);
    const stages = computeStages(v, pr.plan.stops, points, s.nearLimit);
    // Same tolerances as the physics statuses and the rules, so overloadKg = 0 exactly when nothing is flagged.
    for (const st of stages) {
      for (const a of st.axle.axles) overloadKg += Math.max(0, a.kg - a.maxKg - 0.5) + Math.max(0, a.minKg - a.kg - 0.5);
      overloadKg += Math.max(0, st.axle.grossKg - v.grossLimitKg - 0.5);
      if (v.bridgeFormula) for (const b of bridgeFormulaChecks(v, st.axle)) overloadKg += lbToKg(Math.max(0, b.actualLb - b.allowedLb - 1));
    }
    const dep = stages[0].axle;
    overloadKg += Math.max(0, dep.cargoKg - v.payloadKg - 0.5);
    const floor = peakRunningMetreLoad(
      arr.solids.map((sol) => ({ id: sol.id, from: sol.box.min.x, to: sol.box.max.x, kg: sol.kg })),
      v.cargo.l,
    );
    overloadKg += Math.max(0, floor.kgPerM - v.floorKgPerM - 0.5);
    for (const blocked of arr.lifoPairs().values()) if (blocked.length) lifo++;
    if (dep.cog) {
      total += W_COG_M * Math.abs(dep.cog.x - windowCentre(layout.vehicles[vi], slider, dep.cargoKg));
      const lat = lateralImbalance(v, dep.cog);
      total += W_LATERAL * lat;
      if (lat > v.lateralMaxImbalance) {
        warnings++;
        total += W_LATERAL_OVER * (lat - v.lateralMaxImbalance);
      }
      if (dep.cog.z > v.maxCogHeight) {
        warnings++;
        total += W_COG_HEIGHT_M * (dep.cog.z - v.maxCogHeight);
      }
    }
    for (const sol of arr.solids) total += W_STACK * sol.kg * sol.box.min.z;
  });
  total += W_OVERLOAD_KG * overloadKg + W_LIFO * lifo;
  let moved = 0;
  if (pr.keepExisting) {
    pr.existing.forEach((p, i) => {
      const now = layout.placed[i];
      if (p && (!now || !samePlacement(p, now))) moved++;
    });
    total += W_MOVED * moved;
  }
  return { total, unplaced, overloadKg, lifo, warnings, moved, sliders };
}

/** Nothing unplaced and no soft-constraint problem left. */
export function isClean(sc: Score): boolean {
  return sc.unplaced === 0 && sc.overloadKg <= 0 && sc.lifo === 0 && sc.warnings === 0;
}
