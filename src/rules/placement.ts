/**
 * Extreme-point placement search: every anchor of an arrangement x every allowed orientation,
 * settled (dropped and slid against neighbours), filtered by the shared hard checks and ranked by a
 * caller-supplied score. Used by the packer, findPlacementFor and the LIFO fix suggestions.
 */
import { orientedSize, placementBox, placementCog, type Box } from '../domain/geometry';
import type { CargoUnit, Orientation, Vec3 } from '../domain/types';
import type { Anchor, Arrangement, Support } from './arrangement';
import { hazmatIssue, isHazmatRelevant } from './geometry';

export interface Candidate {
  pos: Vec3;
  orient: Orientation;
  box: Box;
  cog: Vec3;
  /** Units it would rest on. */
  sup: Support[];
  /** Indices of units it would have a LIFO conflict with. */
  lifo: number[];
  /** Far side ends flush against a wall or another unit. */
  flush: boolean;
}

export interface SearchOptions {
  orients: readonly Orientation[];
  /** Lower is better; Infinity rejects the candidate. */
  score: (c: Candidate) => number;
  /**
   * Lower bound of the score of any candidate from this anchor. Anchors are visited front to back,
   * so the bound must not decrease with anchor x; the search stops once it reaches the best score.
   */
  bound?: (a: Anchor) => number;
}

const EPS = 1e-6;

/**
 * Extreme points only produce touching positions; units that must keep a distance from hazmat or
 * food units also get anchors exactly that distance behind and beside each of them.
 */
function anchorsFor(arr: Arrangement, unit: CargoUnit): readonly Anchor[] {
  if (!isHazmatRelevant(unit.spec)) return arr.anchors;
  const extra: Anchor[] = [];
  const w = arr.vehicle.cargo.w;
  for (const j of arr.hazmat) {
    const o = arr.solids[j];
    const issue = hazmatIssue(arr.settings, unit.spec, o.unit.spec, 0);
    if (!issue || issue.rule === 'never') continue;
    const b = o.box;
    const d = issue.required;
    extra.push(
      { x: b.max.x + d, y: 0, z: 0, right: false },
      { x: b.max.x + d, y: w, z: 0, right: true },
      { x: b.min.x, y: b.max.y + d, z: 0, right: false },
      { x: b.min.x, y: b.min.y - d, z: 0, right: true },
    );
  }
  return extra.length ? [...arr.anchors, ...extra.filter((a) => a.x < arr.vehicle.cargo.l && a.y >= 0 && a.y <= w)].sort((a, b) => a.x - b.x) : arr.anchors;
}

/** Best legal candidate for one unit, or null. */
export function searchPlacement(arr: Arrangement, unit: CargoUnit, opts: SearchOptions): { cand: Candidate; score: number } | null {
  const spec = unit.spec;
  const sizes = opts.orients.map((o) => orientedSize(spec.dims, o));
  const longest = Math.max(...sizes.map((s) => s.x));
  const tried = new Set<number>();
  let best: Candidate | null = null;
  let bestScore = Infinity;
  for (const a of anchorsFor(arr, unit)) {
    if (a.dead) continue;
    if (opts.bound && opts.bound(a) >= bestScore) break;
    let nbrs: Box[] | null = null;
    for (let k = 0; k < opts.orients.length && !a.dead; k++) {
      const orient = opts.orients[k];
      const size = sizes[k];
      if (a.blockedSizes?.some((f) => size.x >= f.x - EPS && size.y >= f.y - EPS && size.z >= f.z - EPS)) continue;
      // Candidates stay strictly inside the walls (the overlap tolerance is for manual moves only).
      nbrs ??= arr.neighbours(a.x, a.x + longest);
      const settled = arr.settleAt(a, size, nbrs);
      if (!settled) continue;
      const { pos, flush } = settled;
      // Millimetre grid key: x < 2^15 mm, y and z < 2^13 mm, orientation < 8 (fits a double exactly).
      const key = ((Math.round(pos.x * 1000) * 8192 + Math.round(pos.y * 1000)) * 8192 + Math.round(pos.z * 1000)) * 8 + orient;
      if (tried.has(key)) continue;
      tried.add(key);
      const p = { pos, orient };
      const box = placementBox(p, spec);
      const cog = placementCog(p, spec);
      let geometric = false;
      const legal = arr.check(unit, orient, box, cog, (kind) => {
        geometric = kind === 'overlap' || kind === 'bounds' || kind === 'ceiling';
        return true;
      });
      if (!legal) {
        // Space only fills up: an anchor without room for this size never has room for a larger
        // one, and one without room for the smallest remaining unit is finished.
        if (geometric) {
          rememberBlocked(a, size);
          if (arr.minSize && !arr.hasRoom(a, arr.minSize)) a.dead = true;
        }
        continue;
      }
      const sup = arr.supportersOf(box);
      const cand: Candidate = { pos, orient, box, cog, sup, lifo: arr.lifoConflicts(unit, box, sup), flush };
      const score = opts.score(cand);
      if (score < bestScore) {
        best = cand;
        bestScore = score;
      }
    }
  }
  return best ? { cand: best, score: bestScore } : null;
}

/** Keeps the few smallest sizes that found no room at an anchor (none dominating another). */
function rememberBlocked(a: Anchor, size: Vec3): void {
  const list = (a.blockedSizes ??= []);
  if (list.some((f) => size.x >= f.x && size.y >= f.y && size.z >= f.z)) return;
  a.blockedSizes = [...list.filter((f) => !(f.x >= size.x && f.y >= size.y && f.z >= size.z)), size].slice(-4);
}
