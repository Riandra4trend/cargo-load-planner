/**
 * Optimiser: constructive extreme-point packing over several item orders, then simulated annealing
 * within the time budget over sequence perturbations, orientation choices, side preference,
 * heavy-item placement, front gaps, zone sizes and (stable mode) released units. Pure and
 * synchronous; deterministic for a given seed and iteration count.
 */
import { allowedOrientations, orientedSize } from '../domain/geometry';
import type { Id, Placement, TempZone } from '../domain/types';
import { hardViolations } from '../rules/checkPlan';
import { hazmatIssue, usableHeight } from '../rules/geometry';
import { withPacking } from './apply';
import { buildProblem, capacityKg, decode, initialGenome, samePlacement, tightenZones, type Genome, type Layout, type Problem, type SortKey } from './construct';
import { mulberry32 } from './random';
import { isClean, scoreLayout, windowCentre, type Score } from './score';
import type { OptimiseRequest, OptimiseResult } from './types';

interface Evaluated {
  g: Genome;
  layout: Layout;
  sc: Score;
}

const SNAP = 0.05;
const PROGRESS_MS = 50;

function cloneGenome(g: Genome): Genome {
  return {
    order: [...g.order],
    orient: [...g.orient],
    mirror: [...g.mirror],
    pref: [...g.pref],
    gap: [...g.gap],
    zoneLen: g.zoneLen.map((l) => [...l]),
    release: [...g.release],
  };
}

export function optimise(req: OptimiseRequest, onProgress?: (fraction: number) => void): OptimiseResult {
  const t0 = performance.now();
  const budget = Math.max(0, req.timeBudgetMs);
  const deadline = t0 + budget;
  const cap = req.maxIterations === undefined ? Number.POSITIVE_INFINITY : Math.max(1, req.maxIterations);
  const pr = buildProblem(req);
  const rng = mulberry32(req.seed);
  let iterations = 0;
  /** Search progress 0..1: by iterations when capped, else by elapsed time. */
  const schedule = () => (Number.isFinite(cap) ? Math.min(1, iterations / cap) : budget > 0 ? Math.min(1, (performance.now() - t0) / budget) : 1);
  let lastProgress = t0;
  const progress = () => {
    const now = performance.now();
    if (onProgress && now - lastProgress >= PROGRESS_MS) {
      lastProgress = now;
      onProgress(Math.min(0.99, schedule()));
    }
  };
  let slowest = 0;
  const evaluate = (g: Genome): Evaluated => {
    const start = performance.now();
    const layout = decode(pr, g);
    const sc = scoreLayout(pr, layout);
    slowest = Math.max(slowest, performance.now() - start);
    iterations++;
    progress();
    return { g, layout, sc };
  };
  /** Another evaluation still fits in the iteration cap and the time budget (the first one always runs). */
  const hasTime = () => iterations < cap && performance.now() + slowest <= deadline;
  const keys: SortKey[] = ['volume', 'weight', 'area'];
  /** Best of the initial item orders (and `first`), then shifted toward the centre of the COG window. */
  const starts = (first: Evaluated | null): Evaluated => {
    let best = first ?? evaluate(initialGenome(pr, keys[0], true));
    for (const k of first ? keys : keys.slice(1)) {
      if (!hasTime()) return best;
      const e = evaluate(initialGenome(pr, k, true));
      if (e.sc.total < best.sc.total) best = e;
    }
    // Twice: the best slider hole moves with the load.
    for (let round = 0; round < 2 && hasTime(); round++) {
      const g = balancedGenome(best);
      if (!g) break;
      const e = evaluate(g);
      if (e.sc.total >= best.sc.total) break;
      best = e;
    }
    return best;
  };
  let best: Evaluated;
  if (pr.keepExisting) {
    best = evaluate(initialGenome(pr, 'volume', false));
    if (!isClean(best.sc) && hasTime()) best = anneal(pr, starts(best), rng, evaluate, schedule, hasTime);
  } else {
    best = starts(null);
    if (pr.units.length) best = anneal(pr, best, rng, evaluate, schedule, hasTime);
  }
  const result = finish(pr, best, iterations, t0);
  onProgress?.(1);
  return result;
}

/** Genome with front gaps that move each vehicle's cargo COG to the centre of its legal COG window, or null when already there. */
function balancedGenome(e: Evaluated): Genome | null {
  const g = cloneGenome(e.g);
  let changed = false;
  e.layout.arrs.forEach((arr, vi) => {
    if (!arr.solids.length) return;
    let kg = 0;
    let moment = 0;
    let used = 0;
    for (const s of arr.solids) {
      kg += s.kg;
      moment += s.kg * s.cog.x;
      used = Math.max(used, s.box.max.x);
    }
    const slider = e.sc.sliders[vi];
    const v = e.layout.vehicles[vi];
    const shift = windowCentre(v, slider, kg) - moment / kg;
    const step = Math.round(Math.min(v.cargo.l - used, Math.max(-g.gap[vi], shift)) / SNAP) * SNAP;
    if (Math.abs(step) < SNAP - 1e-9) return;
    g.gap[vi] = Math.max(0, g.gap[vi] + step);
    changed = true;
  });
  return changed ? g : null;
}

function anneal(pr: Problem, start: Evaluated, rng: () => number, evaluate: (g: Genome) => Evaluated, schedule: () => number, hasTime: () => boolean): Evaluated {
  let best = start;
  let cur = start;
  const t0Temp = Math.min(20_000, Math.max(300, start.sc.total * 0.02));
  let sinceImprovement = 0;
  while (hasTime()) {
    const temp = t0Temp * Math.pow(1e-3, schedule());
    const cand = evaluate(mutate(pr, cur, rng));
    const delta = cand.sc.total - cur.sc.total;
    if (delta < 0 || rng() < Math.exp(-delta / temp)) cur = cand;
    if (cand.sc.total < best.sc.total - 1e-9) {
      best = cand;
      sinceImprovement = 0;
    } else if (++sinceImprovement > 150) {
      cur = best;
      sinceImprovement = 0;
    }
  }
  return best;
}

/** Index range [from, to) of the stop group containing order position p. */
function groupSpan(pr: Problem, order: readonly number[], p: number): [number, number] {
  const seq = pr.units[order[p]].stopSeq;
  let from = p;
  let to = p + 1;
  while (from > 0 && pr.units[order[from - 1]].stopSeq === seq) from--;
  while (to < order.length && pr.units[order[to]].stopSeq === seq) to++;
  return [from, to];
}

function mutate(pr: Problem, cur: Evaluated, rng: () => number): Genome {
  const g = cloneGenome(cur.g);
  const n = g.order.length;
  const pick = (k: number) => Math.min(k - 1, Math.floor(rng() * k));
  const multiTemp = pr.zoneClasses.map((c, vi) => (c.length > 1 ? vi : -1)).filter((vi) => vi >= 0);
  const r = rng();
  if (pr.keepExisting && rng() < 0.35) {
    const roll = rng();
    if (roll < 0.5) {
      // Release a LIFO blocker together with every unit it blocks.
      const groups = cur.layout.arrs.flatMap((arr) => [...arr.lifoPairs()].map(([a, blocked]) => [a, ...blocked].map((j) => arr.solids[j].id)));
      if (groups.length) {
        for (const id of groups[pick(groups.length)]) {
          const i = pr.indexOf.get(id);
          if (i !== undefined) g.release[i] = true;
        }
        return g;
      }
    }
    const released = g.release.map((rel, i) => (rel && pr.existing[i] ? i : -1)).filter((i) => i >= 0);
    if (roll > 0.85 && released.length) {
      // Pin a released unit back to its original spot (fewer moves).
      g.release[released[pick(released.length)]] = false;
      return g;
    }
    const kept = g.release.map((rel, i) => (!rel && pr.existing[i] ? i : -1)).filter((i) => i >= 0);
    if (kept.length) {
      // Heavier units are released more often: they move the axle loads the most.
      const total = kept.reduce((s, i) => s + pr.units[i].spec.weightKg, 0);
      let x = rng() * total;
      for (const i of kept) {
        x -= pr.units[i].spec.weightKg;
        if (x <= 0) {
          g.release[i] = true;
          break;
        }
      }
      return g;
    }
  }
  if (n === 0 || r >= 0.8) {
    const vi = pick(pr.vehicles.length);
    if (multiTemp.length && rng() < 0.4) {
      const mv = multiTemp[pick(multiTemp.length)];
      const k = pick(g.zoneLen[mv].length);
      g.zoneLen[mv][k] = Math.max(0, g.zoneLen[mv][k] + Math.round(((rng() - 0.5) * 1.6) / SNAP) * SNAP);
    } else {
      const arr = cur.layout.arrs[vi];
      let used = 0;
      for (const s of arr.solids) used = Math.max(used, s.box.max.x);
      const maxGap = Math.max(0, g.gap[vi] + pr.vehicles[vi].cargo.l - used);
      const step = Math.round(((rng() - 0.5) * 1.2) / SNAP) * SNAP || SNAP;
      g.gap[vi] = Math.min(maxGap, Math.max(0, Math.round((g.gap[vi] + step) / SNAP) * SNAP));
    }
    return g;
  }
  const p = pick(n);
  const i = g.order[p];
  const [from, to] = groupSpan(pr, g.order, p);
  if (r < 0.25) {
    const q = from + pick(to - from);
    [g.order[p], g.order[q]] = [g.order[q], g.order[p]];
  } else if (r < 0.37) {
    const [unit] = g.order.splice(p, 1);
    g.order.splice(from + pick(to - from), 0, unit);
  } else if (r < 0.45) {
    let heavy = from;
    for (let q = from; q < to; q++) if (pr.units[g.order[q]].spec.weightKg > pr.units[g.order[heavy]].spec.weightKg) heavy = q;
    const [unit] = g.order.splice(heavy, 1);
    g.order.splice(rng() < 0.5 ? from : to - 1, 0, unit);
  } else if (r < 0.58) {
    const options = allowedOrientations(pr.units[i].spec);
    g.orient[i] = rng() < 0.35 || options.length < 2 ? -1 : options[pick(options.length)];
  } else if (r < 0.68) {
    g.mirror[i] = !g.mirror[i];
  } else if (r < 0.74 && pr.vehicles.length > 1) {
    g.pref[i] = pick(pr.vehicles.length);
  } else if (n > 1) {
    const q = p + 1 < n ? p + 1 : p - 1;
    [g.order[p], g.order[q]] = [g.order[q], g.order[p]];
  }
  return g;
}

function finish(pr: Problem, best: Evaluated, iterations: number, t0: number): OptimiseResult {
  const { layout, sc } = best;
  const placed = [...layout.placed];
  const unplacedIdx = new Set(layout.unplaced);
  const zones: Record<Id, TempZone[]> = {};
  const sliders: Record<Id, number> = {};
  pr.vehicles.forEach((v, vi) => {
    if (pr.zoneClasses[vi].length) zones[v.id] = tightenZones(layout.vehicles[vi], layout.arrs[vi]);
    const x = sc.sliders[vi];
    if (x !== null) sliders[v.id] = x;
  });

  // Defensive final check with the rules engine: a movable unit involved in a hard violation is unplaced.
  for (let round = 0; round < pr.units.length; round++) {
    const offenders = hardOffenders(pr, placed, zones, sliders);
    if (!offenders.length) break;
    for (const i of offenders) {
      placed[i] = null;
      unplacedIdx.add(i);
    }
  }

  const placements: Record<Id, Placement> = {};
  for (const p of pr.fixedPlacements) placements[p.unitId] = p;
  placed.forEach((p) => {
    if (p) placements[p.unitId] = { unitId: p.unitId, vehicleId: p.vehicleId, pos: { ...p.pos }, orient: p.orient };
  });
  const removed = new Set(layout.placed.flatMap((p, i) => (p && !placed[i] ? [p.unitId] : [])));
  const finalLayout: Layout = { ...layout, placed, unplaced: [...unplacedIdx] };
  const unplaced = [...unplacedIdx].map((i) => ({ unitId: pr.units[i].id, reason: unplacedReason(pr, finalLayout, i, removed) }));
  let moved = 0;
  pr.existing.forEach((p, i) => {
    const now = placed[i];
    if (p && (!now || !samePlacement(p, now))) moved++;
  });
  return { placements, zones, sliders, unplaced, moved, score: Math.round(sc.total), iterations, ms: performance.now() - t0 };
}

/** Movable units involved in hard violations of the applied result (indices into pr.units). */
function hardOffenders(pr: Problem, placed: (Placement | null)[], zones: Record<Id, TempZone[]>, sliders: Record<Id, number>): number[] {
  const placements: Record<Id, Placement> = {};
  for (const p of pr.fixedPlacements) placements[p.unitId] = p;
  for (const p of placed) if (p) placements[p.unitId] = p;
  const vehicleIds = pr.vehicles.map((v) => v.id);
  const unplacedIds = pr.units.flatMap((u, i) => (placed[i] ? [] : [u.id]));
  const applied = withPacking(pr.plan, vehicleIds, placements, zones, sliders, unplacedIds);
  const index = new Map(pr.units.map((u, i) => [u.id, i]));
  const offenders = new Set<number>();
  for (const vio of hardViolations(applied, vehicleIds)) {
    // Unplace the most recently listed movable unit of the violation.
    const movable = vio.unitIds.map((id) => index.get(id)).filter((i): i is number => i !== undefined && !!placed[i]);
    if (movable.length) offenders.add(movable[movable.length - 1]);
  }
  return [...offenders];
}

/** Why a unit could not be placed, judged against the final layout (ignoring units the final check removed). */
function unplacedReason(pr: Problem, layout: Layout, i: number, removed: ReadonlySet<Id>): string {
  const u = pr.units[i];
  const { settings } = pr.plan;
  const tol = settings.overlapTolerance;
  let cands = pr.vehicles.map((_, vi) => vi);
  cands = cands.filter((vi) => {
    const v = layout.vehicles[vi];
    const h = usableHeight(v, settings);
    return allowedOrientations(u.spec).some((o) => {
      const s = orientedSize(u.spec.dims, o);
      return s.x <= v.cargo.l + tol && s.y <= v.cargo.w + tol && s.z <= h + 1e-6;
    });
  });
  if (!cands.length) return 'Larger than the cargo space';
  cands = cands.filter((vi) => pr.orients[i][vi].length > 0);
  if (!cands.length) return 'Does not fit through the door';
  if (u.spec.temp !== 'ambient') {
    cands = cands.filter((vi) => layout.vehicles[vi].tempControlled);
    if (!cands.length) return 'Needs temperature control';
  }
  const solidsOf = (vi: number) => layout.arrs[vi].solids.filter((s) => !removed.has(s.id));
  cands = cands.filter((vi) => solidsOf(vi).reduce((kg, s) => kg + s.kg, 0) + u.spec.weightKg <= capacityKg(layout.vehicles[vi]) + 1e-6);
  if (!cands.length) return 'Too heavy for the remaining payload';
  if (u.spec.hazmat) {
    let conflict: string | null = null;
    const free = cands.filter((vi) => {
      const other = solidsOf(vi).find((s) => hazmatIssue(settings, u.spec, s.unit.spec, Infinity)?.rule === 'never');
      if (!other) return true;
      conflict ??= other.label;
      return false;
    });
    if (!free.length && conflict) return `Hazmat conflict with ${conflict}`;
    cands = free;
  }
  if (cands.every((vi) => layout.vehicles[vi].tempControlled)) return `No ${u.spec.temp} zone space left`;
  return 'No space left';
}
