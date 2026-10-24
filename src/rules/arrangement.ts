/**
 * The units placed in one vehicle with their support graph (who rests on whom), transitive stack
 * loads, stack layers and an x-bucket index for neighbour queries. One implementation of every
 * multi-unit hard check (`check`) and of LIFO blocking (`lifoConflicts`, `lifoPairs`), shared by
 * checkPlan, validateMove and the packer.
 */
import { boxesOverlap, footprintOverlap, placementBox, placementCog, type Box } from '../domain/geometry';
import { formatPercent } from '../domain/units';
import type { CargoUnit, Id, ItemSpec, Orientation, Placement, PlanSettings, Vec3, Vehicle } from '../domain/types';
import {
  aboveCeiling,
  blocksRear,
  boxDistance,
  evaluateSupport,
  hasStop,
  hazmatIssue,
  formatWeightRatio,
  hazmatMessage,
  isHazmatRelevant,
  localCheck,
  needsSupport,
  rearOnly,
  restsOn,
  type Fail,
} from './geometry';

export interface Solid {
  id: Id;
  unit: CargoUnit;
  /** Display name, e.g. "Apparel cartons #2". */
  label: string;
  orient: Orientation;
  box: Box;
  cog: Vec3;
  kg: number;
}

/** One supporting unit and the footprint area it carries. */
export interface Support {
  idx: number;
  area: number;
}

/** Candidate anchor for extreme-point packing. Left anchors give the unit's min y, right anchors its max y. */
export interface Anchor {
  x: number;
  y: number;
  z: number;
  right: boolean;
  /** Unit sizes that found no room here (overlap, walls or ceiling); larger sizes are skipped. */
  blockedSizes?: Vec3[];
  /** Not even the smallest remaining unit has room here (space only fills up, so this is final). */
  dead?: boolean;
}

const BUCKET = 0.5;
const EPS = 1e-6;
/** Load above a unit's rating tolerated before it counts as overloaded, kg. */
const LOAD_EPS = 0.5;

export function makeSolid(unit: CargoUnit, label: string, p: Pick<Placement, 'pos' | 'orient'>): Solid {
  return { id: unit.id, unit, label, orient: p.orient, box: placementBox(p, unit.spec), cog: placementCog(p, unit.spec), kg: unit.spec.weightKg };
}

/** Load on top of a unit beyond its rating (only meaningful for stackable, non-fragile units). */
export function overloaded(spec: ItemSpec, loadKg: number): boolean {
  return loadKg > spec.maxLoadOnTopKg + LOAD_EPS;
}

export class Arrangement {
  readonly solids: Solid[] = [];
  /** supports[i]: units that unit i rests on. */
  readonly supports: Support[][] = [];
  /** dependents[i]: units resting directly on unit i. */
  readonly dependents: number[][] = [];
  /** Weight resting on each unit (transitive, split by support-area share), kg. */
  readonly load: number[] = [];
  /** Stack layer, floor = 1. */
  readonly layer: number[] = [];
  /** Lowest maxStackLayers of the unit and every unit below it, and which unit sets it. */
  readonly cap: number[] = [];
  readonly capBy: number[] = [];
  /** Indices of hazmat or food units. */
  readonly hazmat: number[] = [];
  cargoKg = 0;
  readonly tol: number;
  private readonly buckets: number[][];
  private readonly seen: number[] = [];
  private visit = 0;
  /** Reused neighbour list for settle(). */
  private readonly scratch: Box[] = [];
  private anchorList: Anchor[] = [];
  private readonly anchorKeys = new Set<string>();
  private anchorsSorted = true;
  private trackAnchors = false;
  private minX = 0;
  /**
   * Smallest extent along each axis of any unit still to be placed (packer only). Anchors without
   * room for a box this size are dropped.
   */
  minSize: Vec3 | null = null;

  constructor(
    readonly vehicle: Vehicle,
    readonly settings: PlanSettings,
  ) {
    this.tol = settings.overlapTolerance;
    this.buckets = Array.from({ length: Math.max(1, Math.ceil(vehicle.cargo.l / BUCKET)) }, () => []);
  }

  /** Batch build from placed solids (any order). */
  static build(vehicle: Vehicle, settings: PlanSettings, solids: readonly Solid[]): Arrangement {
    const arr = new Arrangement(vehicle, settings);
    for (const s of [...solids].sort((a, b) => a.box.min.z - b.box.min.z)) arr.add(s);
    return arr;
  }

  /** Track extreme-point anchors (once); seeds are x positions where floor anchors start (front gap, zone starts). */
  enableAnchors(minX: number, seedXs: readonly number[]): void {
    if (this.trackAnchors) return;
    this.trackAnchors = true;
    this.minX = minX;
    const w = this.vehicle.cargo.w;
    for (const x of seedXs) {
      this.pushAnchor({ x, y: 0, z: 0, right: false });
      this.pushAnchor({ x, y: w, z: 0, right: true });
    }
    for (const s of this.solids) this.addAnchors(s.box);
  }

  get anchors(): readonly Anchor[] {
    if (!this.anchorsSorted) {
      this.anchorList.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
      this.anchorsSorted = true;
    }
    return this.anchorList;
  }

  /** Visits every unit whose x-bucket range intersects [x0, x1] once; return true from `fn` to stop. */
  near(x0: number, x1: number, fn: (j: number) => boolean | void): void {
    const n = this.buckets.length;
    const b0 = Math.min(n - 1, Math.max(0, Math.floor(x0 / BUCKET)));
    const b1 = Math.min(n - 1, Math.max(0, Math.floor(x1 / BUCKET)));
    const mark = ++this.visit;
    for (let b = b0; b <= b1; b++) {
      for (const j of this.buckets[b]) {
        if (this.seen[j] === mark) continue;
        this.seen[j] = mark;
        if (fn(j)) return;
      }
    }
  }

  /** Units a box at this position would rest on. */
  supportersOf(box: Box): Support[] {
    const out: Support[] = [];
    if (!needsSupport(box, this.tol)) return out;
    this.near(box.min.x, box.max.x, (j) => {
      const b = this.solids[j].box;
      if (restsOn(box, b)) out.push({ idx: j, area: footprintOverlap(box, b) });
    });
    return out;
  }

  /** Spreads weight w over the supporters by footprint share, transitively down to the floor. */
  distribute(sup: readonly Support[], w: number, fn: (j: number, kg: number) => void): void {
    let total = 0;
    for (const s of sup) total += s.area;
    if (total <= 0) return;
    for (const s of sup) {
      const ws = (w * s.area) / total;
      fn(s.idx, ws);
      this.distribute(this.supports[s.idx], ws, fn);
    }
  }

  /** Layer and layer cap a unit with this spec would get on these supporters. */
  stackLayer(spec: ItemSpec, sup: readonly Support[], selfIdx: number): { layer: number; cap: number; capBy: number } {
    let layer = 1;
    let cap = spec.maxStackLayers;
    let capBy = selfIdx;
    for (const s of sup) {
      layer = Math.max(layer, this.layer[s.idx] + 1);
      if (this.cap[s.idx] < cap) {
        cap = this.cap[s.idx];
        capBy = this.capBy[s.idx];
      }
    }
    return { layer, cap, capBy };
  }

  /** Adds a solid. Incremental use requires that nothing already placed ends up resting on it (check() enforces this). */
  add(solid: Solid): number {
    const idx = this.solids.length;
    const sup = this.supportersOf(solid.box);
    this.solids.push(solid);
    this.supports.push(sup);
    this.dependents.push([]);
    this.seen.push(0);
    for (const s of sup) this.dependents[s.idx].push(idx);
    const st = this.stackLayer(solid.unit.spec, sup, idx);
    this.layer.push(st.layer);
    this.cap.push(st.cap);
    this.capBy.push(st.capBy);
    this.load.push(0);
    this.distribute(sup, solid.kg, (j, kg) => {
      this.load[j] += kg;
    });
    const n = this.buckets.length;
    const b0 = Math.min(n - 1, Math.max(0, Math.floor(solid.box.min.x / BUCKET)));
    const b1 = Math.min(n - 1, Math.max(0, Math.floor(solid.box.max.x / BUCKET)));
    for (let b = b0; b <= b1; b++) this.buckets[b].push(idx);
    if (isHazmatRelevant(solid.unit.spec)) this.hazmat.push(idx);
    this.cargoKg += solid.kg;
    if (this.trackAnchors) {
      this.anchorList = this.anchorList.filter((a) => {
        if (a.dead) return false;
        if (!insideBox(a, solid.box)) return true;
        this.anchorKeys.delete(anchorKey(a));
        return false;
      });
      this.addAnchors(solid.box);
    }
    return idx;
  }

  /**
   * Every hard check for placing `unit` at `box` against the units in this arrangement: unit-local
   * checks, overlaps, nothing ending up underneath an existing unit, support, stacking (stackable,
   * fragile, load on every unit below, layers) and hazmat segregation. With `fail` null the check
   * stops at the first problem. Returns true when legal.
   */
  check(unit: CargoUnit, orient: Orientation, box: Box, cog: Vec3, fail: Fail | null): boolean {
    const spec = unit.spec;
    const s = this.settings;
    const tol = this.tol;
    const sys = s.units;
    let ok = true;
    const f: Fail = (kind, message, others) => {
      ok = false;
      return fail ? fail(kind, message, others) : true;
    };
    if (localCheck(spec, orient, box, this.vehicle, s, f)) return false;

    let stop = false;
    this.near(box.min.x - EPS, box.max.x + EPS, (j) => {
      const o = this.solids[j];
      if (boxesOverlap(box, o.box, tol)) stop = f('overlap', () => `Overlaps ${o.label}`, [j]);
      else if (restsOn(o.box, box)) stop = f('stacking', () => `Would end up under ${o.label}`, [j]);
      return stop;
    });
    if (stop) return false;

    if (needsSupport(box, tol)) {
      const sup = this.supportersOf(box);
      const ev = evaluateSupport(
        box,
        cog,
        sup.map((x) => this.solids[x.idx].box),
      );
      const idxs = sup.map((x) => x.idx);
      if (ev.fraction < s.supportRatio - 1e-9) {
        if (f('support', () => `Only ${formatPercent(ev.fraction)} of the base is supported (needs ${formatPercent(s.supportRatio)})`, idxs)) return false;
      } else if (!ev.cogInside && f('support', () => 'Centre of gravity is not over the supporting units', idxs)) {
        return false;
      }
      for (const x of sup) {
        const o = this.solids[x.idx];
        if (o.unit.spec.fragile) {
          if (f('fragile', () => `Cannot stack on fragile ${o.label}`, [x.idx])) return false;
        } else if (!o.unit.spec.stackable && f('stacking', () => `Cannot stack on ${o.label} (not stackable)`, [x.idx])) {
          return false;
        }
      }
      const extra = new Map<number, number>();
      this.distribute(sup, unit.spec.weightKg, (j, kg) => extra.set(j, (extra.get(j) ?? 0) + kg));
      for (const [j, kg] of extra) {
        const o = this.solids[j];
        const total = this.load[j] + kg;
        if (o.unit.spec.stackable && !o.unit.spec.fragile && overloaded(o.unit.spec, total)) {
          if (f('stacking', () => `Too much weight on ${o.label}: ${formatWeightRatio(total, o.unit.spec.maxLoadOnTopKg, sys)}`, [j])) return false;
        }
      }
      const st = this.stackLayer(spec, sup, -1);
      if (st.layer > st.cap) {
        const by = st.capBy >= 0 ? this.solids[st.capBy] : null;
        const msg = by ? `Would be layer ${st.layer}; ${by.label} allows at most ${st.cap}` : `Would be layer ${st.layer}; this item allows at most ${st.cap}`;
        if (f('stacking', () => msg, by ? [st.capBy] : [])) return false;
      }
    }

    if (isHazmatRelevant(spec)) {
      for (const j of this.hazmat) {
        const o = this.solids[j];
        const issue = hazmatIssue(s, spec, o.unit.spec, boxDistance(box, o.box));
        if (issue && f('hazmat', () => hazmatMessage(issue, spec, o.unit.spec, o.label, s), [j])) return false;
      }
    }
    return ok;
  }

  /** Transitive set of units below the given supporters. */
  below(sup: readonly Support[], out: Set<number> = new Set()): Set<number> {
    for (const s of sup) {
      if (out.has(s.idx)) continue;
      out.add(s.idx);
      this.below(this.supports[s.idx], out);
    }
    return out;
  }

  /**
   * LIFO conflicts of a unit at `box` resting on `sup`: units it would block or that would block it
   * (rear doors, rear-only vehicles) and earlier-stop units below it (any vehicle).
   */
  lifoConflicts(unit: CargoUnit, box: Box, sup: readonly Support[]): number[] {
    const out: number[] = [];
    if (!hasStop(unit)) return out;
    const seq = unit.stopSeq;
    if (rearOnly(this.vehicle)) {
      this.solids.forEach((o, j) => {
        if (!hasStop(o.unit)) return;
        const os = o.unit.stopSeq;
        if ((os > seq && blocksRear(o.box, box, this.tol)) || (seq > os && blocksRear(box, o.box, this.tol))) out.push(j);
      });
    }
    for (const j of this.below(sup)) {
      const o = this.solids[j].unit;
      if (hasStop(o) && o.stopSeq < seq && !out.includes(j)) out.push(j);
    }
    return out;
  }

  /** Every LIFO blocking relation in the arrangement: blocked[i] = units that unit i blocks. */
  lifoPairs(): Map<number, number[]> {
    const blocked = new Map<number, number[]>();
    const add = (a: number, b: number) => {
      const list = blocked.get(a);
      if (!list) blocked.set(a, [b]);
      else if (!list.includes(b)) list.push(b);
    };
    const n = this.solids.length;
    if (rearOnly(this.vehicle)) {
      for (let i = 0; i < n; i++) {
        const a = this.solids[i];
        if (!hasStop(a.unit)) continue;
        for (let j = 0; j < n; j++) {
          const b = this.solids[j];
          if (i === j || !hasStop(b.unit) || a.unit.stopSeq <= b.unit.stopSeq) continue;
          if (blocksRear(a.box, b.box, this.tol)) add(i, j);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const a = this.solids[i].unit;
      if (!hasStop(a) || this.supports[i].length === 0) continue;
      for (const j of this.below(this.supports[i])) {
        const b = this.solids[j].unit;
        if (hasStop(b) && b.stopSeq < a.stopSeq) add(i, j);
      }
    }
    return blocked;
  }

  /** Boxes whose x-range overlaps [x0, x1] (fresh array). */
  neighbours(x0: number, x1: number): Box[] {
    const out: Box[] = [];
    this.near(x0, x1, (j) => {
      const b = this.solids[j].box;
      if (x1 - b.min.x > EPS && b.max.x - x0 > EPS) out.push(b);
    });
    return out;
  }

  /**
   * Position of a box of `size` at an anchor: pulled back from the far wall when it would stick out,
   * dropped onto the highest surface below it and slid sideways against the nearest wall or unit
   * on its anchor side (x stays the anchor's). Null when it cannot stay strictly inside the walls.
   * `flush`: the far side ends against a wall or unit. `nbrs` may be any superset of the boxes whose
   * x-range overlaps the candidate's (e.g. shared by all orientations at one anchor).
   */
  settleAt(a: Anchor, size: Vec3, nbrs: readonly Box[] = this.neighbours(a.x, a.x + size.x)): { pos: Vec3; flush: boolean } | null {
    const { l, w } = this.vehicle.cargo;
    if (size.y > w + EPS || a.x + size.x > l + EPS) return null;
    let y = a.right ? Math.max(0, a.y - size.y) : Math.min(a.y, w - size.y);
    let z = a.z;
    const x1 = a.x + size.x;
    const near = this.scratch;
    near.length = 0;
    for (const b of nbrs) if (x1 - b.min.x > EPS) near.push(b);
    const drop = () => {
      let top = 0;
      for (const b of near) if (b.max.z <= z + EPS && b.max.z > top && y + size.y - b.min.y > EPS && b.max.y - y > EPS) top = b.max.z;
      z = top;
    };
    drop();
    let wall = a.right ? w : 0;
    let far = a.right ? 0 : w;
    for (const b of near) {
      if (z + size.z - b.min.z <= EPS || b.max.z - z <= EPS) continue;
      if (a.right) {
        if (b.min.y >= y + size.y - EPS && b.min.y < wall) wall = b.min.y;
        if (b.max.y <= y + EPS && b.max.y > far) far = b.max.y;
      } else {
        if (b.max.y <= y + EPS && b.max.y > wall) wall = b.max.y;
        if (b.min.y >= y + size.y - EPS && b.min.y < far) far = b.min.y;
      }
    }
    y = a.right ? wall - size.y : wall;
    drop();
    if (y < -EPS || y + size.y > w + EPS) return null;
    return { pos: { x: a.x, y, z }, flush: a.right ? Math.abs(far - y) < 0.01 : Math.abs(far - (y + size.y)) < 0.01 };
  }

  /** A box of this size has room at the anchor (walls, ceiling and other units only). */
  hasRoom(a: Anchor, size: Vec3): boolean {
    const settled = this.settleAt(a, size);
    if (!settled) return false;
    const { pos } = settled;
    const box: Box = { min: pos, max: { x: pos.x + size.x, y: pos.y + size.y, z: pos.z + size.z } };
    if (aboveCeiling(box, this.vehicle, this.settings)) return false;
    let free = true;
    this.near(box.min.x - EPS, box.max.x + EPS, (j) => {
      if (boxesOverlap(box, this.solids[j].box, this.tol)) free = false;
      return !free;
    });
    return free;
  }

  /** Extreme points created by a placed box, each also projected toward the front. */
  private addAnchors(b: Box): void {
    const pts: Anchor[] = [
      { x: b.max.x, y: b.min.y, z: b.min.z, right: false },
      { x: b.min.x, y: b.max.y, z: b.min.z, right: false },
      { x: b.min.x, y: b.min.y, z: b.max.z, right: false },
      { x: b.max.x, y: b.max.y, z: b.min.z, right: true },
      { x: b.min.x, y: b.min.y, z: b.min.z, right: true },
      { x: b.min.x, y: b.max.y, z: b.max.z, right: true },
    ];
    for (const p of pts) {
      if (p.y < -EPS || p.y > this.vehicle.cargo.w + EPS || p.x >= this.vehicle.cargo.l - EPS) continue;
      const x = Math.max(this.minX, p.x);
      this.pushAnchor({ ...p, x });
      const px = this.projectFront(x, p.right ? p.y - EPS * 10 : p.y + EPS * 10, p.z + EPS * 10);
      if (px < x - EPS) this.pushAnchor({ ...p, x: px });
    }
  }

  private pushAnchor(a: Anchor): void {
    const key = anchorKey(a);
    if (this.anchorKeys.has(key)) return;
    let covered = false;
    this.near(a.x, a.x, (j) => (covered = insideBox(a, this.solids[j].box)));
    if (covered) return;
    this.anchorKeys.add(key);
    this.anchorList.push(a);
    this.anchorsSorted = false;
  }

  /** Front-most x a point at (x, y, z) can slide to before hitting a unit. */
  private projectFront(x: number, y: number, z: number): number {
    let best = this.minX;
    this.near(this.minX, x, (j) => {
      const b = this.solids[j].box;
      if (b.max.x <= x + EPS && b.max.x > best && y > b.min.y && y < b.max.y && z > b.min.z && z < b.max.z) best = b.max.x;
    });
    return Math.min(best, x);
  }
}

function insideBox(a: Anchor, b: Box): boolean {
  const y = a.right ? a.y - EPS * 10 : a.y + EPS * 10;
  return a.x >= b.min.x - EPS && a.x < b.max.x - EPS && y > b.min.y && y < b.max.y && a.z >= b.min.z - EPS && a.z < b.max.z - EPS;
}

const anchorKey = (a: Anchor): string => `${a.right ? 'r' : 'l'}${Math.round(a.x * 1e4)},${Math.round(a.y * 1e4)},${Math.round(a.z * 1e4)}`;
