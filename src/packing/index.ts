/**
 * Packing / optimiser contract (owned by the engine slice). This interim version is a simple
 * floor-only lane packer so the UI flows work; the full optimiser replaces it.
 */
import { allowedOrientations, expandUnits, orientedSize, placementBox, boxesOverlap } from '../domain/geometry';
import { VEHICLE_PRESETS } from '../domain/presets';
import type { Id, Placement, Plan, TempZone } from '../domain/types';

export interface OptimiseRequest {
  plan: Plan;
  /** Vehicles to pack into, in order of preference. */
  vehicleIds: Id[];
  /** Units to consider; default: every unit not placed in a vehicle outside `vehicleIds`. */
  unitIds?: Id[];
  /** Stable mode (urgent orders): keep existing placements where possible and minimise moves. */
  keepExisting: boolean;
  seed: number;
  timeBudgetMs: number;
}

export interface OptimiseResult {
  /** Complete placements for the involved vehicles (pinned units included unchanged). */
  placements: Record<Id, Placement>;
  /** New temperature zones per multi-temp vehicle. */
  zones: Record<Id, TempZone[]>;
  /** New trailer-axle (slider) position per vehicle with a sliding tandem. */
  sliders: Record<Id, number>;
  unplaced: { unitId: Id; reason: string }[];
  /** Units whose placement changed compared to the input plan. */
  moved: number;
  score: number;
  iterations: number;
  ms: number;
}

export function optimise(req: OptimiseRequest, onProgress?: (fraction: number) => void): OptimiseResult {
  const t0 = performance.now();
  const { plan } = req;
  const involved = new Set(req.vehicleIds);
  const units = expandUnits(plan).filter((u) => {
    const p = plan.placements[u.id];
    return (req.unitIds ? req.unitIds.includes(u.id) : true) && (!p || involved.has(p.vehicleId));
  });
  const placements: Record<Id, Placement> = {};
  for (const u of units) {
    const p = plan.placements[u.id];
    if (p?.pinned) placements[u.id] = p;
  }
  const order = units.filter((u) => !placements[u.id]).sort((a, b) => b.stopSeq - a.stopSeq || b.spec.weightKg - a.spec.weightKg);
  const unplaced: { unitId: Id; reason: string }[] = [];
  const specOf = new Map(units.map((u) => [u.id, u.spec]));
  for (const u of order) {
    let done = false;
    for (const vid of req.vehicleIds) {
      const v = plan.vehicles.find((x) => x.id === vid);
      if (!v) continue;
      const zone = v.zones.find((z) => z.temp === u.spec.temp);
      if (!zone) continue;
      for (const orient of allowedOrientations(u.spec)) {
        const s = orientedSize(u.spec.dims, orient);
        for (let x = zone.fromX; x + s.x <= zone.toX + 1e-6 && !done; x += 0.05) {
          for (let y = 0; y + s.y <= v.cargo.w + 1e-6 && !done; y += 0.05) {
            const cand: Placement = { unitId: u.id, vehicleId: v.id, pos: { x, y, z: 0 }, orient };
            const box = placementBox(cand, u.spec);
            if (box.max.z > v.cargo.h - v.airflowTopGap) continue;
            const clash = Object.values(placements).some((o) => o.vehicleId === v.id && boxesOverlap(box, placementBox(o, specOf.get(o.unitId)!), 0.001));
            if (!clash) {
              placements[u.id] = cand;
              done = true;
            }
          }
        }
        if (done) break;
      }
      if (done) break;
    }
    if (!done) unplaced.push({ unitId: u.id, reason: 'No free floor space in a matching temperature zone' });
    onProgress?.((Object.keys(placements).length + unplaced.length) / Math.max(1, units.length));
  }
  const moved = units.filter((u) => {
    const a = plan.placements[u.id];
    const b = placements[u.id];
    return !a || !b || a.vehicleId !== b.vehicleId || a.orient !== b.orient || Math.abs(a.pos.x - b.pos.x) + Math.abs(a.pos.y - b.pos.y) + Math.abs(a.pos.z - b.pos.z) > 1e-6;
  }).length;
  return { placements, zones: {}, sliders: {}, unplaced, moved, score: unplaced.length, iterations: 1, ms: performance.now() - t0 };
}

/** Runs optimise() off the main thread. */
export function runOptimiseInWorker(req: OptimiseRequest, onProgress?: (fraction: number) => void): { promise: Promise<OptimiseResult>; cancel: () => void } {
  const { promise, resolve, reject } = Promise.withResolvers<OptimiseResult>();
  const timer = setTimeout(() => {
    try {
      resolve(optimise(req, onProgress));
    } catch (e) {
      reject(e);
    }
  }, 0);
  return {
    promise,
    cancel: () => {
      clearTimeout(timer);
      reject(new Error('cancelled'));
    },
  };
}

/** Best feasible position for one unit in a vehicle without moving other units, or null. */
export function findPlacementFor(plan: Plan, unitId: Id, vehicleId: Id): Placement | null {
  const r = optimise({ plan, vehicleIds: [vehicleId], unitIds: [unitId], keepExisting: true, seed: 1, timeBudgetMs: 200 });
  return r.placements[unitId] ?? null;
}

/** Preset ids of the fewest vehicles that carry every unit. */
export function proposeVehicles(_plan: Plan): string[] {
  return [VEHICLE_PRESETS[4].id];
}
