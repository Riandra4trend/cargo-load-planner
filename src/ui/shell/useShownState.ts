import { useMemo } from 'react';
import type { AxleState, Plan } from '../../domain/types';
import { computeAxleState, remainingCapacity, type MassPoint, type Remaining } from '../../physics';
import { loadingSequence, type LoadStep } from '../../sim/sequence';
import type { VehicleEval } from '../../state/evaluate';
import { useActiveVehicleEval, useDisplayPlan } from '../../state/hooks';
import { useStore } from '../../state/store';

export interface ShownState {
  vehicleEval: VehicleEval;
  /** Stage shown in the panels (0 = departure); null while the load simulation shows a partial load. */
  stage: number | null;
  axle: AxleState;
  /** Mass points aboard in the shown state. */
  points: MassPoint[];
  remaining: Remaining;
  /** Short description of the shown state, e.g. "at departure", "after stop 2". */
  caption: string;
}

/** Memoised loading sequence of a vehicle in the displayed plan. */
export function useLoadingSequence(vehicleId: string): LoadStep[] {
  const plan = useDisplayPlan();
  return useMemo(() => loadingSequence(plan, vehicleId), [plan, vehicleId]);
}

function partialState(plan: Plan, ve: VehicleEval, sequence: LoadStep[], step: number): Omit<ShownState, 'vehicleEval'> {
  const n = Math.max(0, Math.min(step, sequence.length));
  const aboard = new Set(sequence.slice(0, n).map((s) => s.unitId));
  const points = ve.points.filter((p) => aboard.has(p.id));
  const axle = computeAxleState(ve.vehicle, points, plan.settings.nearLimit);
  return { stage: null, axle, points, remaining: remainingCapacity(ve.vehicle, axle), caption: `loading, ${n}/${sequence.length} aboard` };
}

/**
 * The load state the right panel shows for the active vehicle: departure normally, the selected
 * stage during the unload simulation, or the partial load during the load simulation.
 */
export function useShownState(): ShownState {
  const plan = useDisplayPlan();
  const ve = useActiveVehicleEval();
  const anim = useStore((s) => s.ui.animation);
  const animating = anim.mode !== 'idle' && anim.vehicleId === ve.vehicle.id;
  const sequence = useLoadingSequence(ve.vehicle.id);

  return useMemo(() => {
    if (animating && anim.mode === 'load') return { vehicleEval: ve, ...partialState(plan, ve, sequence, anim.step) };
    const stageIndex = animating && anim.mode === 'unload' ? Math.max(0, Math.min(anim.step, ve.stages.length - 1)) : 0;
    const st = ve.stages[stageIndex];
    const aboard = new Set(st.unitIds);
    const points = stageIndex === 0 ? ve.points : ve.points.filter((p) => aboard.has(p.id));
    return {
      vehicleEval: ve,
      stage: st.stage,
      axle: st.axle,
      points,
      remaining: stageIndex === 0 ? ve.remaining : remainingCapacity(ve.vehicle, st.axle),
      caption: st.stage === 0 ? 'at departure' : `after stop ${st.stage}`,
    };
  }, [animating, anim.mode, anim.step, plan, ve, sequence]);
}
