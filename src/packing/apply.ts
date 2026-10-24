import type { Id, Placement, Plan, TempZone } from '../domain/types';

/**
 * Plan with a packing outcome applied (pure, same semantics as the store's applyOptimiseResult):
 * non-pinned placements in the involved vehicles are replaced, unplaced units lose their
 * placement, zones and slider positions are updated.
 */
export function withPacking(
  plan: Plan,
  vehicleIds: readonly Id[],
  placements: Readonly<Record<Id, Placement>>,
  zones: Readonly<Record<Id, TempZone[]>>,
  sliders: Readonly<Record<Id, number>>,
  unplaced: readonly Id[],
): Plan {
  const involved = new Set(vehicleIds);
  const next: Record<Id, Placement> = {};
  for (const [id, p] of Object.entries(plan.placements)) if (!involved.has(p.vehicleId) || p.pinned) next[id] = p;
  Object.assign(next, placements);
  for (const id of unplaced) delete next[id];
  const vehicles = plan.vehicles.map((v) => {
    let out = v;
    if (zones[v.id]) out = { ...out, zones: zones[v.id] };
    const x = sliders[v.id];
    if (x !== undefined && out.statics.type === 'artic') out = { ...out, statics: { ...out.statics, trailerAxle: { ...out.statics.trailerAxle, x } } };
    return out;
  });
  return { ...plan, vehicles, placements: next };
}
