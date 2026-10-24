import { describe, expect, it } from 'vitest';
import { createSeedPlan, createTankerSeedPlan, createTipperSeedPlan } from '../data/seed';
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

/** A tanker plan exactly as wave 1 saved it: `vehicle.tank`, `spec.liquid { liquidId }`, packaging 'bulk-liquid'. */
const WAVE1_TANK = {
  compartments: [
    { id: 'c1', label: 'C1', fromX: 0, toX: 3.1, capacityL: 8000 },
    { id: 'c2', label: 'C2', fromX: 3.1, toX: 6.2, capacityL: 8000 },
  ],
  baffled: false,
  foodGrade: false,
  insulated: false,
};
const WAVE1_SPEC = {
  name: 'Diesel (solar)',
  sku: '',
  category: 'Bulk liquid',
  origin: '',
  shape: 'box',
  dims: { l: 1, w: 1, h: 1 },
  weightKg: 6720,
  cogOffset: { x: 0, y: 0, z: 0 },
  packaging: 'bulk-liquid',
  palletHeight: 0,
  stackable: false,
  maxLoadOnTopKg: 0,
  maxStackLayers: 1,
  fragile: false,
  keepUpright: true,
  rotation: 'none',
  temp: 'ambient',
  isFood: false,
  hazmat: { unNumber: 'UN1202', hazClass: '3', packingGroup: 'III' },
  liquid: { liquidId: 'diesel', name: 'Diesel (solar)', densityKgPerL: 0.84, volumeL: 8000 },
};
const WAVE1_DRUM_LIQUID = { liquidId: 'custom', name: 'Coolant', densityKgPerL: 1.11, volumeL: 50, containerCapacityL: 60 };

function wave1TankerJson(): string {
  const plan = JSON.parse(JSON.stringify(createSeedPlan()));
  const vehicle = JSON.parse(JSON.stringify(createVehicle('tanker-rigid-16k', 'veh-1')));
  delete vehicle.bulk;
  vehicle.tank = WAVE1_TANK;
  plan.vehicles = [vehicle];
  plan.lines = [
    { id: 'line-diesel', quantity: 1, stopId: 'stop-1', priority: 'normal', contents: '8,000 L', spec: WAVE1_SPEC },
    { id: 'line-coolant', quantity: 2, stopId: 'stop-2', priority: 'normal', spec: { ...WAVE1_SPEC, name: 'Coolant', packaging: 'custom', hazmat: undefined, liquid: WAVE1_DRUM_LIQUID } },
  ];
  plan.placements = { 'line-diesel#0': { unitId: 'line-diesel#0', vehicleId: 'veh-1', compartmentId: 'c2', pos: { x: 3.1, y: 0, z: 0 }, orient: 0 } };
  return JSON.stringify(plan);
}

describe('tanker plans', () => {
  it('migrates wave-1 tanks and liquid contents to bulk specs and materials', () => {
    const upgraded = parsePlanJson(wave1TankerJson());
    const v = upgraded.vehicles[0];
    expect(v.bulk).toEqual({ kind: 'tank', ...WAVE1_TANK, pressurised: false });
    expect('tank' in v).toBe(false);

    const [diesel, coolant] = upgraded.lines.map((l) => l.spec);
    expect(diesel.material).toEqual({ materialId: 'diesel', name: 'Diesel (solar)', state: 'liquid', densityKgPerL: 0.84, volumeL: 8000 });
    expect(diesel.packaging).toBe('bulk');
    expect('liquid' in diesel).toBe(false);
    expect(coolant.material).toEqual({ materialId: 'custom', name: 'Coolant', state: 'liquid', densityKgPerL: 1.11, volumeL: 50, containerCapacityL: 60 });
    expect(coolant.packaging).toBe('custom');
    expect(upgraded.placements['line-diesel#0'].compartmentId).toBe('c2');
  });

  it('round-trips current tanker and dump-truck plans exactly', () => {
    for (const plan of [createTankerSeedPlan(), createTipperSeedPlan()]) expect(parsePlanJson(JSON.stringify(plan))).toEqual(plan);
  });

  it('defaults a missing pressure flag and returns fills of missing compartments to Unplaced', () => {
    const plan = createTankerSeedPlan();
    const saved = JSON.parse(JSON.stringify(plan));
    delete saved.vehicles[0].bulk.pressurised;
    const [first, second] = Object.keys(plan.placements);
    saved.placements[first].compartmentId = 'c99';
    saved.vehicles[0].bulk.compartments = saved.vehicles[0].bulk.compartments.filter((c: { id: string }) => c.id !== plan.placements[second].compartmentId);

    const upgraded = parsePlanJson(JSON.stringify(saved));
    expect(upgraded.vehicles[0].bulk?.pressurised).toBe(false);
    expect(upgraded.placements[first]).toBeUndefined();
    expect(upgraded.placements[second]).toBeUndefined();
    expect(Object.keys(upgraded.placements)).toHaveLength(Object.keys(plan.placements).length - 2);
  });

  it('rejects a malformed tank, dump body or material', () => {
    const legacy = JSON.parse(wave1TankerJson());
    legacy.vehicles[0].tank.compartments = 'C1';
    expect(() => parsePlanJson(JSON.stringify(legacy))).toThrow(/invalid tank or dump body/);
    const tipper = JSON.parse(JSON.stringify(createTipperSeedPlan()));
    tipper.lines[0].spec.material.state = 'gas';
    expect(() => parsePlanJson(JSON.stringify(tipper))).toThrow(/invalid material contents/);
  });
});
