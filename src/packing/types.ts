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
  /**
   * Stop after this many layout evaluations. With a cap (and a time budget that is not reached) the
   * annealing schedule follows the iteration count, so the result depends only on the plan and seed.
   */
  maxIterations?: number;
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

/** Messages posted by the optimiser worker. */
export type WorkerMessage = { type: 'progress'; fraction: number } | { type: 'done'; result: OptimiseResult } | { type: 'error'; message: string };
