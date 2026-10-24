/**
 * Packing problem setup and the constructive decoder: a genome (sequence, orientation choices,
 * side preference, vehicle preference, front gaps, zone sizes, released units) is turned into a
 * legal layout with extreme-point placement. Every candidate passes the shared hard checks of the
 * rules engine; LIFO conflicts are avoided whenever a conflict-free spot exists.
 */
import { allowedOrientations, expandUnits, isBulkLiquid, orientedSize, placementBox, placementCog } from '../domain/geometry';
import { vehicleTareKg } from '../domain/presets';
import type { CargoUnit, Id, Orientation, Placement, Plan, TempClass, TempZone, Vec3, Vehicle } from '../domain/types';
import { Arrangement, makeSolid, type Solid } from '../rules/arrangement';
import { planIndex } from '../rules/context';
import { fitsDoor, usableHeight } from '../rules/geometry';
import { searchPlacement, type Candidate } from '../rules/placement';
import type { OptimiseRequest } from './types';

/** Zone order front to rear: frozen next to the reefer unit, then chilled, then ambient. */
export const TEMP_ORDER: readonly TempClass[] = ['frozen', 'chilled', 'ambient'];
/** Penalty per LIFO conflict when no conflict-free spot exists (candidate score units). */
const CANDIDATE_LIFO_PENALTY = 1000;
/** Stable mode: score bonus for a released unit staying exactly where it was (half the LIFO penalty). */
const KEEP_BONUS = 500;
const EPS = 1e-6;

export interface Problem {
  plan: Plan;
  vehicles: Vehicle[];
  /** Units the optimiser may place or move. */
  units: CargoUnit[];
  labels: Map<Id, string>;
  /** Movable unit index by unit id. */
  indexOf: Map<Id, number>;
  /** Per vehicle: pinned units and units outside the request, as fixed obstacles. */
  fixed: Solid[][];
  /** Original placement objects of the fixed units. */
  fixedPlacements: Placement[];
  /** Per movable unit: its current placement when it is in an involved vehicle. */
  existing: (Placement | null)[];
  existingVehicle: number[];
  /** [unit][vehicle] orientations allowed by the rotation rule that fit the cargo space and the door. */
  orients: Orientation[][][];
  /** Per vehicle: temperature classes of its zones when the optimiser sizes them (multi-temp), else empty. */
  zoneClasses: TempClass[][];
  /** Smallest extent along each axis of any movable unit in any usable orientation (dead-anchor pruning). */
  minSize: Vec3 | null;
  keepExisting: boolean;
}

export interface Genome {
  order: number[];
  /** -1 = choose among all usable orientations, else a preferred orientation. */
  orient: number[];
  /** Prefer the right wall instead of the left. */
  mirror: boolean[];
  /** Vehicle index tried first. */
  pref: number[];
  /** Empty length left at the front of each vehicle, metres. */
  gap: number[];
  /** Per multi-temp vehicle: zone lengths per class in zoneClasses order (the last zone runs to the doors). */
  zoneLen: number[][];
  /** keepExisting: the unit's current placement is released for re-packing. */
  release: boolean[];
}

export interface Layout {
  vehicles: Vehicle[];
  arrs: Arrangement[];
  /** Per movable unit. */
  placed: (Placement | null)[];
  unplaced: number[];
}

export function capacityKg(v: Vehicle): number {
  return Math.min(v.payloadKg, v.grossLimitKg - vehicleTareKg(v));
}

/** Orientations of a spec that fit a vehicle's cargo space, ceiling and door. */
export function usableOrientations(unit: CargoUnit, v: Vehicle, plan: Plan): Orientation[] {
  const h = usableHeight(v, plan.settings);
  const tol = plan.settings.overlapTolerance;
  return allowedOrientations(unit.spec).filter((o) => {
    const s = orientedSize(unit.spec.dims, o);
    return s.x <= v.cargo.l + tol && s.y <= v.cargo.w + tol && s.z <= h + EPS && fitsDoor(s, v);
  });
}

export function buildProblem(req: OptimiseRequest): Problem {
  const { plan } = req;
  const { labels } = planIndex(plan);
  const vehicles = req.vehicleIds.map((id) => plan.vehicles.find((v) => v.id === id)).filter((v): v is Vehicle => !!v);
  const vIndex = new Map(vehicles.map((v, i) => [v.id, i]));
  const known = new Set(plan.vehicles.map((v) => v.id));
  const requested = req.unitIds ? new Set(req.unitIds) : null;
  const units: CargoUnit[] = [];
  const existing: (Placement | null)[] = [];
  const existingVehicle: number[] = [];
  const fixed: Solid[][] = vehicles.map(() => []);
  const fixedPlacements: Placement[] = [];
  for (const u of expandUnits(plan)) {
    // Bulk liquid fills go to tanker compartments (packing/tanks.ts), never onto a floor.
    if (isBulkLiquid(u.spec)) continue;
    const p = plan.placements[u.id];
    const vi = p ? vIndex.get(p.vehicleId) : undefined;
    const elsewhere = !!p && vi === undefined && known.has(p.vehicleId);
    const considered = requested ? requested.has(u.id) : !elsewhere;
    if (p && vi !== undefined && (p.pinned || !considered)) {
      fixed[vi].push(makeSolid(u, labels.get(u.id) ?? u.spec.name, p));
      fixedPlacements.push(p);
    } else if (considered && !p?.pinned) {
      units.push(u);
      existing.push(p && vi !== undefined ? p : null);
      existingVehicle.push(vi ?? -1);
    }
  }
  const orients = units.map((u) => vehicles.map((v) => usableOrientations(u, v, plan)));
  const zoneClasses = vehicles.map((v, vi) => {
    if (!v.multiTemp || !v.tempControlled) return [];
    const present = new Set<TempClass>(fixed[vi].map((s) => s.unit.spec.temp));
    units.forEach((u, i) => {
      if (orients[i][vi].length) present.add(u.spec.temp);
    });
    return TEMP_ORDER.filter((t) => present.has(t));
  });
  const indexOf = new Map(units.map((u, i) => [u.id, i]));
  let minSize: Vec3 | null = null;
  units.forEach((u, i) => {
    for (const list of orients[i]) {
      for (const o of list) {
        const s = orientedSize(u.spec.dims, o);
        minSize = minSize ? { x: Math.min(minSize.x, s.x), y: Math.min(minSize.y, s.y), z: Math.min(minSize.z, s.z) } : s;
      }
    }
  });
  return { plan, vehicles, units, labels, indexOf, fixed, fixedPlacements, existing, existingVehicle, orients, zoneClasses, minSize, keepExisting: req.keepExisting };
}

const baseArea = (u: CargoUnit): number => {
  const d = u.spec.dims;
  return Math.min(d.l * d.w, d.l * d.h, d.w * d.h) || d.l * d.w;
};

/** Initial zone lengths per class: floor need (smallest base area) plus slack. */
function initialZoneLengths(pr: Problem, vi: number): number[] {
  const v = pr.vehicles[vi];
  return pr.zoneClasses[vi].map((c) => {
    let area = 0;
    let longest = 0;
    pr.units.forEach((u, i) => {
      if (u.spec.temp !== c || !pr.orients[i][vi].length) return;
      area += baseArea(u);
      longest = Math.max(longest, Math.min(u.spec.dims.l, u.spec.dims.w));
    });
    let fixedEnd = 0;
    for (const s of pr.fixed[vi]) if (s.unit.spec.temp === c) fixedEnd = Math.max(fixedEnd, s.box.max.x);
    return Math.min(v.cargo.l, Math.max(fixedEnd, (area / v.cargo.w) * 1.15 + longest * 0.5));
  });
}

export type SortKey = 'volume' | 'weight' | 'area';

/** Sequence: stop descending, then zone order, then the key (largest first). */
export function initialGenome(pr: Problem, key: SortKey, releaseAll: boolean): Genome {
  const metric = (u: CargoUnit) => {
    const d = u.spec.dims;
    if (key === 'volume') return d.l * d.w * d.h;
    if (key === 'weight') return u.spec.weightKg;
    return baseArea(u);
  };
  const order = pr.units.map((_, i) => i);
  order.sort((a, b) => {
    const ua = pr.units[a];
    const ub = pr.units[b];
    return ub.stopSeq - ua.stopSeq || TEMP_ORDER.indexOf(ua.spec.temp) - TEMP_ORDER.indexOf(ub.spec.temp) || metric(ub) - metric(ua) || a - b;
  });
  return {
    order,
    orient: pr.units.map(() => -1),
    mirror: pr.units.map(() => false),
    pref: pr.units.map((_, i) => Math.max(0, pr.existingVehicle[i])),
    gap: pr.vehicles.map(() => 0),
    zoneLen: pr.vehicles.map((v, vi) => (!releaseAll && pr.keepExisting && currentZoneLengths(v, pr.zoneClasses[vi])) || initialZoneLengths(pr, vi)),
    release: pr.units.map((_, i) => releaseAll || !pr.existing[i]),
  };
}

/** Lengths of the vehicle's current zones when they already follow the class order, else null. */
function currentZoneLengths(v: Vehicle, classes: readonly TempClass[]): number[] | null {
  const zones = [...v.zones].sort((a, b) => a.fromX - b.fromX);
  if (zones.length !== classes.length || zones.some((z, k) => z.temp !== classes[k])) return null;
  return zones.map((z) => z.toX - z.fromX);
}

/** Zones from lengths (first zone includes the front gap), adjusted so no fixed unit straddles a bulkhead. */
function zonesFromLengths(v: Vehicle, classes: readonly TempClass[], lens: readonly number[], gap: number, fixed: readonly Solid[]): TempZone[] | null {
  if (!classes.length) return null;
  const n = classes.length;
  const b: number[] = [0];
  let x = gap;
  for (let k = 1; k < n; k++) {
    x += Math.max(0, lens[k - 1]);
    b.push(Math.min(v.cargo.l, Math.max(b[k - 1], x)));
  }
  b.push(v.cargo.l);
  for (let k = 1; k < n; k++) {
    let lo = b[k - 1];
    let hi = v.cargo.l;
    for (const s of fixed) {
      const ci = classes.indexOf(s.unit.spec.temp);
      if (ci < 0) continue;
      if (ci < k) lo = Math.max(lo, s.box.max.x);
      else hi = Math.min(hi, s.box.min.x);
    }
    if (lo > hi + EPS) return null;
    b[k] = Math.min(hi, Math.max(lo, b[k]));
  }
  return classes.map((temp, k) => ({ id: `zone-${k + 1}`, temp, fromX: b[k], toX: b[k + 1] }));
}

function candidateScore(c: Candidate, width: number, mirror: boolean): number {
  const side = mirror ? (width - c.box.max.y) / width : c.box.min.y / width;
  return 10 * c.box.min.x + 3 * c.box.min.z + side - (c.flush ? 0.5 : 0) + CANDIDATE_LIFO_PENALTY * c.lifo.length;
}

/** Builds the layout of a genome. May grow multi-temp zones in the genome when a class runs out of space. */
export function decode(pr: Problem, g: Genome): Layout {
  let layout = construct(pr, g);
  for (let attempt = 0; attempt < 3 && growZones(pr, g, layout); attempt++) layout = construct(pr, g);
  return layout;
}

function construct(pr: Problem, g: Genome): Layout {
  const { plan } = pr;
  const nV = pr.vehicles.length;
  const kept = pr.units.map((_, i) => pr.keepExisting && !!pr.existing[i] && !g.release[i]);
  const vehicles = pr.vehicles.map((v, vi) => {
    const keptSolids = pr.units.flatMap((u, i) => (kept[i] && pr.existingVehicle[i] === vi ? [makeSolid(u, '', pr.existing[i]!)] : []));
    const zones = zonesFromLengths(v, pr.zoneClasses[vi], g.zoneLen[vi], g.gap[vi], [...pr.fixed[vi], ...keptSolids]);
    return zones ? { ...v, zones } : v;
  });
  const arrs = vehicles.map((v) => {
    const arr = new Arrangement(v, plan.settings);
    arr.minSize = pr.minSize;
    return arr;
  });
  const placed: (Placement | null)[] = pr.units.map(() => null);
  const obstacles: Solid[][] = pr.fixed.map((list) => [...list]);
  pr.units.forEach((u, i) => {
    if (!kept[i]) return;
    const p = pr.existing[i]!;
    obstacles[pr.existingVehicle[i]].push(makeSolid(u, pr.labels.get(u.id) ?? u.spec.name, p));
    placed[i] = p;
  });
  arrs.forEach((arr, vi) => {
    for (const s of obstacles[vi].sort((a, b) => a.box.min.z - b.box.min.z)) arr.add(s);
    const gap = g.gap[vi];
    const seeds = [gap, ...vehicles[vi].zones.map((z) => z.fromX).filter((x) => x > gap + EPS && x < vehicles[vi].cargo.l - EPS)];
    arr.enableAnchors(gap, seeds);
  });

  const unplaced: number[] = [];
  for (const i of g.order) {
    if (kept[i]) continue;
    const u = pr.units[i];
    let best: { vi: number; cand: Candidate; score: number } | null = null;
    for (let k = 0; k < nV; k++) {
      const vi = (g.pref[i] + k) % nV;
      const arr = arrs[vi];
      const all = pr.orients[i][vi];
      if (!all.length || arr.cargoKg + u.spec.weightKg > capacityKg(vehicles[vi]) + EPS) continue;
      const width = vehicles[vi].cargo.w;
      const search = (orients: readonly Orientation[]) =>
        searchPlacement(arr, u, { orients, score: (c) => candidateScore(c, width, g.mirror[i]), bound: (a) => 10 * a.x - 0.5 });
      const preferred = g.orient[i];
      let found = preferred >= 0 && all.includes(preferred as Orientation) ? search([preferred as Orientation]) : null;
      if (!found || found.cand.lifo.length) {
        const any = search(all);
        if (any && (!found || any.score < found.score)) found = any;
      }
      // Stable mode: a released unit keeps its original spot when that is still legal there.
      const orig = pr.keepExisting && pr.existingVehicle[i] === vi ? pr.existing[i] : null;
      if (orig) {
        const box = placementBox(orig, u.spec);
        const cog = placementCog(orig, u.spec);
        if (arr.check(u, orig.orient, box, cog, null)) {
          const sup = arr.supportersOf(box);
          const cand: Candidate = { pos: orig.pos, orient: orig.orient, box, cog, sup, lifo: arr.lifoConflicts(u, box, sup), flush: true };
          const score = candidateScore(cand, width, g.mirror[i]) - KEEP_BONUS;
          if (!found || score < found.score) found = { cand, score };
        }
      }
      if (!found) continue;
      if (!best || found.score < best.score) best = { vi, ...found };
      if (found.cand.lifo.length === 0) break;
    }
    if (!best) {
      unplaced.push(i);
      continue;
    }
    const p: Placement = { unitId: u.id, vehicleId: vehicles[best.vi].id, pos: best.cand.pos, orient: best.cand.orient };
    arrs[best.vi].add(makeSolid(u, pr.labels.get(u.id) ?? u.spec.name, p));
    placed[i] = p;
  }
  return { vehicles, arrs, placed, unplaced };
}

/** Grows the zones of classes with unplaced units, taking free length from the other zones. Returns true when changed. */
function growZones(pr: Problem, g: Genome, layout: Layout): boolean {
  let changed = false;
  pr.vehicles.forEach((v, vi) => {
    const classes = pr.zoneClasses[vi];
    if (classes.length < 2) return;
    const need = classes.map(() => 0);
    for (const i of layout.unplaced) {
      const u = pr.units[i];
      const k = classes.indexOf(u.spec.temp);
      if (k >= 0 && pr.orients[i][vi].length && layout.arrs[vi].cargoKg + u.spec.weightKg <= capacityKg(v)) need[k] += (baseArea(u) / v.cargo.w) * 1.2;
    }
    if (need.every((n) => n <= EPS)) return;
    const zones = layout.vehicles[vi].zones;
    const spare = classes.map((c) => {
      const z = zones.find((x) => x.temp === c);
      if (!z) return 0;
      let used = z.fromX;
      for (const s of layout.arrs[vi].solids) if (s.unit.spec.temp === c) used = Math.max(used, s.box.max.x);
      return Math.max(0, z.toX - used);
    });
    need.forEach((n, k) => {
      if (n <= EPS) return;
      let want = n;
      classes.forEach((_, j) => {
        if (j === k || want <= EPS || spare[j] <= EPS) return;
        const take = Math.min(spare[j], want);
        spare[j] -= take;
        want -= take;
        g.zoneLen[vi][j] = Math.max(0, g.zoneLen[vi][j] - take);
        changed = true;
      });
      const gained = n - want;
      if (gained > EPS) g.zoneLen[vi][k] += gained;
    });
  });
  return changed;
}

/**
 * Bulkheads moved onto the actual load: each boundary sits at the rear end of the class in front of
 * it (never past the first unit of the next class); classes without units are dropped.
 */
export function tightenZones(v: Vehicle, arr: Arrangement): TempZone[] {
  const present = TEMP_ORDER.filter((t) => arr.solids.some((s) => s.unit.spec.temp === t));
  if (!present.length) return v.zones;
  const zones: TempZone[] = [];
  let from = 0;
  present.forEach((temp, k) => {
    let to = v.cargo.l;
    if (k < present.length - 1) {
      let end = from;
      let nextStart = v.cargo.l;
      for (const s of arr.solids) {
        const ci = present.indexOf(s.unit.spec.temp);
        if (ci <= k) end = Math.max(end, s.box.max.x);
        else nextStart = Math.min(nextStart, s.box.min.x);
      }
      // Bulkhead at the end of the front class, rounded up to the centimetre or millimetre when that still clears the next class.
      to = [Math.ceil(end * 100 - 1e-6) / 100, Math.ceil(end * 1000 - 1e-6) / 1000].find((x) => x <= nextStart + 1e-9) ?? end;
    }
    zones.push({ id: `zone-${k + 1}`, temp, fromX: from, toX: to });
    from = to;
  });
  return zones;
}

/** True when two placements put a unit in the same spot. */
export function samePlacement(a: Placement, b: Placement): boolean {
  return a.vehicleId === b.vehicleId && a.orient === b.orient && Math.abs(a.pos.x - b.pos.x) + Math.abs(a.pos.y - b.pos.y) + Math.abs(a.pos.z - b.pos.z) < 1e-4;
}
