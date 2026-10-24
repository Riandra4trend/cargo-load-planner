import { describe, expect, it } from 'vitest';
import { createSeedPlan, createTankerSeedPlan } from '../data/seed';
import { createVehicle } from '../domain/presets';
import { defaultSettings } from '../domain/settings';
import { parsePlanJson } from './planFile';

describe('loading plans saved before fuel estimates existed', () => {
  it('fills fuel profiles and settings, and spreads the old route total over the stop legs', () => {
    const plan = createSeedPlan();
    const legacy = JSON.parse(JSON.stringify(plan));
    for (const v of legacy.vehicles) delete v.fuel;
    for (const s of legacy.stops) delete s.distanceKm;
    for (const key of ['fuelPricePerL', 'currency', 'co2KgPerL', 'avgSpeedKmh', 'stopMinutes', 'idleMinutesPerStop']) delete legacy.settings[key];
    delete legacy.meta.returnKm;
    legacy.meta.distanceKm = 152;

    const upgraded = parsePlanJson(JSON.stringify(legacy));
    expect(upgraded.vehicles[0].fuel).toEqual(createVehicle('us-reefer-53').fuel);
    expect(upgraded.settings.currency).toBe(defaultSettings().currency);
    expect(upgraded.settings.fuelPricePerL).toBe(defaultSettings().fuelPricePerL);
    expect(upgraded.meta.returnKm).toBe(0);
    expect('distanceKm' in upgraded.meta).toBe(false);
    expect(upgraded.stops.map((s) => s.distanceKm)).toEqual([30.4, 30.4, 30.4, 30.4, 30.4]);
  });

  it('leaves a current plan unchanged', () => {
    const plan = createSeedPlan();
    expect(parsePlanJson(JSON.stringify(plan))).toEqual(plan);
  });
});

describe('tanker plans', () => {
  it('round-trips tanks, liquid contents and compartment placements exactly', () => {
    const plan = createTankerSeedPlan();
    expect(parsePlanJson(JSON.stringify(plan))).toEqual(plan);
  });

  it('defaults a missing pressure flag and returns fills of missing compartments to Unplaced', () => {
    const plan = createTankerSeedPlan();
    const legacy = JSON.parse(JSON.stringify(plan));
    delete legacy.vehicles[0].tank.pressurised;
    const [first, second] = Object.keys(plan.placements);
    legacy.placements[first].compartmentId = 'c99';
    legacy.vehicles[0].tank.compartments = legacy.vehicles[0].tank.compartments.filter((c: { id: string }) => c.id !== plan.placements[second].compartmentId);

    const upgraded = parsePlanJson(JSON.stringify(legacy));
    expect(upgraded.vehicles[0].tank?.pressurised).toBe(false);
    expect(upgraded.placements[first]).toBeUndefined();
    expect(upgraded.placements[second]).toBeUndefined();
    expect(Object.keys(upgraded.placements)).toHaveLength(Object.keys(plan.placements).length - 2);
  });

  it('rejects a malformed tank', () => {
    const legacy = JSON.parse(JSON.stringify(createTankerSeedPlan()));
    legacy.vehicles[0].tank.compartments = 'C1';
    expect(() => parsePlanJson(JSON.stringify(legacy))).toThrow(/invalid tank/);
  });
});
