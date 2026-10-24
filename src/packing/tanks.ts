/**
 * Tanker compartment assignment for bulk liquid fills. Exhaustive (depth-first over feasible
 * compartments, pruned by the hard tank rules) for up to 8 fills, otherwise greedy plus pairwise
 * moves and swaps. Lexicographic objective: placed fills (urgent count triple); axle, minimum-share,
 * gross and payload excess at every stage; surge; moved fills (stable mode); worst axle utilisation.
 */
import { bulkCog, compartmentOf, isBulkLiquid } from '../domain/geometry';
import { needsPressureTank } from '../domain/liquids';
import { hazmatRule } from '../domain/settings';
import type { CargoUnit, Id, Placement, Plan, TankCompartment, Vehicle } from '../domain/types';
import { computeStages, type StagePoint } from '../physics';
import { planIndex } from '../rules/context';
import { fillIssues, pairIssue, stageExcessKg, surges, worstUtilisation, type FillRef } from '../rules/tank';

/** Fills searched exhaustively; above this, greedy plus local search. */
const EXHAUSTIVE_MAX = 8;
/** Leaf evaluations of the exhaustive search. */
const LEAF_CAP = 60_000;

interface Slot {
  ti: number;
  c: TankCompartment;
  index: number;
}

interface Score {
  unplaced: number;
  excess: number;
  surge: number;
  moved: number;
  worst: number;
}

export interface TankResult {
  placements: Record<Id, Placement>;
  unplaced: { unitId: Id; reason: string }[];
  /** Fills whose tanker or compartment changed. */
  moved: number;
  score: number;
  iterations: number;
}

function better(a: Score, b: Score): boolean {
  if (a.unplaced !== b.unplaced) return a.unplaced < b.unplaced;
  if (Math.abs(a.excess - b.excess) > 0.5) return a.excess < b.excess;
  if (a.surge !== b.surge) return a.surge < b.surge;
  if (a.moved !== b.moved) return a.moved < b.moved;
  return a.worst < b.worst - 1e-9;
}

const scalar = (s: Score): number => Math.round(s.unplaced * 100_000 + s.excess * 100 + s.surge * 1000 + s.moved * 500 + s.worst * 100);

/**
 * Assigns `fills` (movable bulk units) to the compartments of `tankers`. Placements in those
 * tankers that are pinned or outside the request (`fixedIds`) stay where they are.
 */
export function assignTanks(
  plan: Plan,
  tankers: readonly Vehicle[],
  fills: readonly CargoUnit[],
  fixedIds: ReadonlySet<Id>,
  opts: { keepExisting: boolean; maxIterations?: number; deadline: number },
): TankResult {
  const s = plan.settings;
  const { units, labels } = planIndex(plan);
  const tIndex = new Map(tankers.map((v, i) => [v.id, i]));

  // Fixed fills occupy their compartments.
  const fixed: FillRef[][] = tankers.map(() => []);
  const fixedPlacements: Placement[] = [];
  const fixedPoints: StagePoint[][] = tankers.map(() => []);
  for (const p of Object.values(plan.placements)) {
    const ti = tIndex.get(p.vehicleId);
    if (ti === undefined || !fixedIds.has(p.unitId)) continue;
    fixedPlacements.push(p);
    const v = tankers[ti];
    const c = compartmentOf(v, p.compartmentId);
    const u = units.get(p.unitId);
    if (!c || !u || !isBulkLiquid(u.spec)) continue;
    fixed[ti].push({ id: p.unitId, label: labels.get(p.unitId) ?? u.spec.name, spec: u.spec, c, index: v.tank!.compartments.indexOf(c) });
    const g = bulkCog(v, c, u.spec);
    fixedPoints[ti].push({ id: p.unitId, x: g.x, y: g.y, z: g.z, kg: u.spec.weightKg, stopSeq: u.stopSeq });
  }
  const fixedSurge = fixed.reduce((sum, list, ti) => sum + list.filter((f) => surges(tankers[ti], f.c, f.spec)).length, 0);

  const slots: Slot[] = [];
  tankers.forEach((v, ti) => {
    v.tank!.compartments.forEach((c, index) => {
      if (!fixed[ti].some((f) => f.c.id === c.id)) slots.push({ ti, c, index });
    });
  });

  const n = fills.length;
  const ref = (i: number, slot: Slot): FillRef => ({ id: fills[i].id, label: labels.get(fills[i].id) ?? fills[i].spec.name, spec: fills[i].spec, c: slot.c, index: slot.index });
  // Feasible slots per fill: compartment checks and pairs with fixed fills.
  const feasible: number[][] = fills.map((u, i) =>
    slots.flatMap((slot, k) => {
      const v = tankers[slot.ti];
      if (fillIssues(v, slot.c, u.spec).length) return [];
      const r = ref(i, slot);
      return fixed[slot.ti].some((f) => pairIssue(v, s, r, f)) ? [] : [k];
    }),
  );
  const compatible = (i: number, k: number, j: number, l: number): boolean => {
    const a = slots[k];
    const b = slots[l];
    return a.ti !== b.ti || !pairIssue(tankers[a.ti], s, ref(i, a), ref(j, b));
  };
  const existingSlot = fills.map((u) => {
    const p = plan.placements[u.id];
    return p ? slots.findIndex((slot) => tankers[slot.ti].id === p.vehicleId && slot.c.id === p.compartmentId) : -1;
  });

  let iterations = 0;
  const cap = Math.min(LEAF_CAP, opts.maxIterations ?? Infinity);
  const hasTime = () => iterations < cap && performance.now() < opts.deadline;

  /** assignment[i] = slot index or -1. */
  const score = (assignment: readonly number[]): Score => {
    iterations++;
    let unplaced = 0;
    let surge = fixedSurge;
    let moved = 0;
    const points = fixedPoints.map((list) => [...list]);
    assignment.forEach((k, i) => {
      const u = fills[i];
      if (k < 0) {
        unplaced += u.priority === 'urgent' ? 3 : 1;
        if (existingSlot[i] >= 0 || plan.placements[u.id]) moved++;
        return;
      }
      const slot = slots[k];
      const v = tankers[slot.ti];
      const g = bulkCog(v, slot.c, u.spec);
      points[slot.ti].push({ id: u.id, x: g.x, y: g.y, z: g.z, kg: u.spec.weightKg, stopSeq: u.stopSeq });
      if (surges(v, slot.c, u.spec)) surge++;
      if (plan.placements[u.id] && existingSlot[i] !== k) moved++;
    });
    let excess = 0;
    let worst = 0;
    tankers.forEach((v, ti) => {
      if (!points[ti].length) return;
      const stages = computeStages(v, plan.stops, points[ti], s.nearLimit);
      excess += stageExcessKg(v, stages) + Math.max(0, stages[0].axle.cargoKg - v.payloadKg - 0.5);
      worst = Math.max(worst, worstUtilisation(stages));
    });
    return { unplaced, excess, surge, moved: opts.keepExisting ? moved : 0, worst };
  };

  const legalWith = (assignment: readonly number[], i: number, k: number): boolean => {
    for (let j = 0; j < assignment.length; j++) {
      const l = assignment[j];
      if (j === i || l < 0) continue;
      if (l === k || !compatible(i, k, j, l)) return false;
    }
    return true;
  };

  let best: number[] = fills.map(() => -1);
  let bestScore = score(best);
  const consider = (assignment: number[]) => {
    const sc = score(assignment);
    if (better(sc, bestScore)) {
      best = [...assignment];
      bestScore = sc;
    }
  };

  // Stable mode: keep every existing legal fill and add the rest greedily; done when that is clean.
  if (opts.keepExisting) {
    const start = fills.map(() => -1);
    existingSlot.forEach((k, i) => {
      if (k >= 0 && feasible[i].includes(k) && legalWith(start, i, k)) start[i] = k;
    });
    const kept = greedy(start);
    consider(kept);
    if (bestScore.unplaced === 0 && bestScore.excess <= 0 && bestScore.surge === 0) return finish();
  }

  if (n <= EXHAUSTIVE_MAX) {
    const order = fills.map((_, i) => i).sort((a, b) => feasible[a].length - feasible[b].length || (fills[b].spec.liquid?.volumeL ?? 0) - (fills[a].spec.liquid?.volumeL ?? 0) || a - b);
    const assignment = fills.map(() => -1);
    const dfs = (d: number, unplaced: number) => {
      if (!hasTime() || unplaced > bestScore.unplaced) return;
      if (d === n) {
        consider(assignment);
        return;
      }
      const i = order[d];
      for (const k of feasible[i]) {
        if (!legalWith(assignment, i, k)) continue;
        assignment[i] = k;
        dfs(d + 1, unplaced);
        assignment[i] = -1;
      }
      dfs(d + 1, unplaced + (fills[i].priority === 'urgent' ? 3 : 1));
    };
    dfs(0, 0);
  } else {
    consider(greedy(fills.map(() => -1)));
  }
  improve();
  return finish();

  /** Fills without a slot, largest first, each into the slot with the best partial score. */
  function greedy(start: number[]): number[] {
    const assignment = [...start];
    const order = fills.map((_, i) => i).filter((i) => assignment[i] < 0).sort((a, b) => (fills[b].spec.liquid?.volumeL ?? 0) - (fills[a].spec.liquid?.volumeL ?? 0) || a - b);
    for (const i of order) {
      let bestK = -1;
      let bestSc: Score | null = null;
      for (const k of feasible[i]) {
        if (!legalWith(assignment, i, k)) continue;
        assignment[i] = k;
        const sc = score(assignment);
        assignment[i] = -1;
        if (!bestSc || better(sc, bestSc)) {
          bestSc = sc;
          bestK = k;
        }
      }
      assignment[i] = bestK;
    }
    return assignment;
  }

  /** Single moves to free slots and pairwise swaps while they improve the best assignment. */
  function improve(): void {
    let improved = true;
    while (improved && hasTime()) {
      improved = false;
      for (let i = 0; i < n && hasTime(); i++) {
        for (const k of feasible[i]) {
          if (best[i] === k) continue;
          const cand = [...best];
          const j = cand.indexOf(k);
          if (j >= 0) {
            if (best[i] < 0 || !feasible[j].includes(best[i])) continue;
            cand[j] = best[i];
          }
          cand[i] = k;
          if (!legalWith(cand, i, k) || (j >= 0 && !legalWith(cand, j, cand[j]))) continue;
          const sc = score(cand);
          if (better(sc, bestScore)) {
            best = cand;
            bestScore = sc;
            improved = true;
          }
        }
      }
    }
  }

  function finish(): TankResult {
    const placements: Record<Id, Placement> = {};
    for (const p of fixedPlacements) placements[p.unitId] = p;
    const unplaced: TankResult['unplaced'] = [];
    const aboard = fixed.map((list) => [...list]);
    best.forEach((k, i) => {
      if (k >= 0) aboard[slots[k].ti].push(ref(i, slots[k]));
    });
    let moved = 0;
    best.forEach((k, i) => {
      const u = fills[i];
      const prev = plan.placements[u.id];
      if (k < 0) {
        unplaced.push({ unitId: u.id, reason: unplacedReason(plan, tankers, u, aboard) });
        if (prev) moved++;
        return;
      }
      const slot = slots[k];
      const v = tankers[slot.ti];
      placements[u.id] = { unitId: u.id, vehicleId: v.id, compartmentId: slot.c.id, pos: { x: slot.c.fromX, y: 0, z: 0 }, orient: 0 };
      if (prev && (prev.vehicleId !== v.id || prev.compartmentId !== slot.c.id)) moved++;
    });
    return { placements, unplaced, moved, score: scalar(bestScore), iterations };
  }
}

/** Why a fill found no compartment (`aboard` = fills per tanker in the final assignment). */
function unplacedReason(plan: Plan, tankers: readonly Vehicle[], u: CargoUnit, aboard: readonly FillRef[][]): string {
  if (!tankers.length) return 'Needs a tanker';
  let cands = tankers.map((_, i) => i);
  const keep = (pred: (v: Vehicle) => boolean, reason: string): string | null => {
    const next = cands.filter((i) => pred(tankers[i]));
    if (!next.length) return reason;
    cands = next;
    return null;
  };
  const pressure = needsPressureTank(u.spec.liquid?.liquidId ?? '');
  const reason =
    keep((v) => v.tank!.pressurised === pressure, pressure ? 'Needs a pressurised tank' : 'A pressurised tank only carries liquefied gas') ??
    (u.spec.isFood ? keep((v) => v.tank!.foodGrade, 'Needs a food-grade tank') : null) ??
    (u.spec.temp !== 'ambient' ? keep((v) => v.tank!.insulated, 'Needs an insulated tank') : null) ??
    keep((v) => v.tank!.compartments.some((c) => !fillIssues(v, c, u.spec).length), 'No free compartment large enough');
  if (reason) return reason;
  const hazClass = u.spec.hazmat?.hazClass;
  let conflict: string | null = null;
  const free = cands.filter((i) => {
    const other = hazClass ? aboard[i].find((f) => f.spec.hazmat && hazmatRule(plan.settings, hazClass, f.spec.hazmat.hazClass) === 'never') : undefined;
    if (!other) return true;
    conflict ??= other.label;
    return false;
  });
  if (!free.length && conflict) return `Hazmat conflict with ${conflict}`;
  return 'No free compartment large enough';
}
