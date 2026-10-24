import type { Plan, UnitSystem, Vehicle } from '../domain/types';
import { evaluatePlan, type PlanEval, type VehicleEval } from './evaluate';
import { useStore, type UiState } from './store';

let ghostCache: { plan: Plan; drag: NonNullable<UiState['drag']>; result: Plan } | null = null;

/**
 * The plan to display and evaluate: the optimiser preview while a result awaits Accept/Revert,
 * otherwise the committed plan with the drag ghost applied. Returns stable object identities.
 */
export function displayPlanOf(plan: Plan, ui: UiState): Plan {
  if (ui.optimise.diff) return ui.optimise.diff.preview;
  const drag = ui.drag;
  if (!drag) return plan;
  if (ghostCache && ghostCache.plan === plan && ghostCache.drag === drag) return ghostCache.result;
  const result: Plan = { ...plan, placements: { ...plan.placements, [drag.unitId]: drag.ghost } };
  ghostCache = { plan, drag, result };
  return result;
}

export const useDisplayPlan = (): Plan => useStore((s) => displayPlanOf(s.plan, s.ui));

/** Physics + rules evaluation of the displayed plan (memoised per plan object). */
export const useEvaluation = (): PlanEval => evaluatePlan(useDisplayPlan());

export const useUnitSystem = (): UnitSystem => useStore((s) => s.plan.settings.units);

/** The vehicle selected in the UI (falls back to the first vehicle). */
export function useActiveVehicle(): Vehicle {
  const plan = useDisplayPlan();
  const id = useStore((s) => s.ui.activeVehicleId);
  return plan.vehicles.find((v) => v.id === id) ?? plan.vehicles[0];
}

export function useActiveVehicleEval(): VehicleEval {
  const evaluation = useEvaluation();
  const vehicle = useActiveVehicle();
  return evaluation.byVehicle[vehicle.id];
}
