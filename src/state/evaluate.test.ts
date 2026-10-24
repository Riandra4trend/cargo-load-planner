import { beforeEach, describe, expect, it } from 'vitest';
import { createTankerSeedPlan } from '../data/seed';
import { unitIdOf } from '../domain/geometry';
import type { Plan } from '../domain/types';
import { evaluatePlan } from './evaluate';
import { useStore } from './store';

const DIESEL_1 = unitIdOf('line-diesel-1', 0);
const GASOLINE_1 = unitIdOf('line-gasoline-1', 0);

/** The tanker sample with only the 7,700 L diesel fill aboard, in the given compartment. */
function singleFill(compartmentId: string): Plan {
  const plan = createTankerSeedPlan();
  const c = plan.vehicles[0].tank!.compartments.find((x) => x.id === compartmentId)!;
  return { ...plan, placements: { [DIESEL_1]: { unitId: DIESEL_1, vehicleId: 'veh-1', compartmentId, pos: { x: c.fromX, y: 0, z: 0 }, orient: 0 } } };
}

describe('tanker evaluation', () => {
  it('weighs a compartment fill as volume × density at the compartment centre', () => {
    const front = evaluatePlan(singleFill('c1')).byVehicle['veh-1'];
    const rear = evaluatePlan(singleFill('c5')).byVehicle['veh-1'];
    const c1 = front.vehicle.tank!.compartments[0];
    const c5 = front.vehicle.tank!.compartments[4];
    expect(front.axle.cargoKg).toBeCloseTo(7700 * 0.84, 6);
    expect(front.points[0].x).toBeCloseTo((c1.fromX + c1.toX) / 2, 9);
    expect(rear.points[0].x).toBeCloseTo((c5.fromX + c5.toX) / 2, 9);
    // Moving the same fill rearward shifts load from the drive axle onto the trailer group.
    const [, frontDrive, frontTrailer] = front.axle.axles;
    const [, rearDrive, rearTrailer] = rear.axle.axles;
    expect(rearDrive.kg).toBeLessThan(frontDrive.kg);
    expect(rearTrailer.kg).toBeGreaterThan(frontTrailer.kg);
  });

  it('reports compartments as bays filled by volume over capacity', () => {
    const ve = evaluatePlan(singleFill('c1')).byVehicle['veh-1'];
    expect(ve.bays.map((b) => b.label)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
    expect(ve.bays[0].fill).toBeCloseTo(7700 / 8000, 9);
    expect(ve.bays[0].kg).toBeCloseTo(7700 * 0.84, 6);
    expect(ve.bays.slice(1).every((b) => b.fill === 0 && b.kg === 0)).toBe(true);
    expect(ve.fill.volume).toBeCloseTo(7700 / 32_000, 9);
    expect(ve.fill.ldm).toBe(0);
    expect(evaluatePlan(singleFill('c1')).bayOfUnit[DIESEL_1]).toBe('C1');
  });
});

describe('assignCompartment', () => {
  beforeEach(() => useStore.getState().replacePlan(createTankerSeedPlan()));

  it('swaps two fills of the same tanker', () => {
    useStore.getState().assignCompartment(DIESEL_1, 'veh-1', 'c2');
    const { placements } = useStore.getState().plan;
    expect(placements[DIESEL_1].compartmentId).toBe('c2');
    expect(placements[GASOLINE_1].compartmentId).toBe('c1');
  });

  it('unloads the occupant when the incoming fill was not in this tanker', () => {
    useStore.getState().unplaceUnits([DIESEL_1]);
    useStore.getState().assignCompartment(DIESEL_1, 'veh-1', 'c2');
    const { placements } = useStore.getState().plan;
    expect(placements[DIESEL_1].compartmentId).toBe('c2');
    expect(placements[GASOLINE_1]).toBeUndefined();
  });
});
