import { describe, expect, it } from 'vitest';
import { createVehicle } from '../domain/presets';
import { defaultSettings } from '../domain/settings';
import type { Plan, Stop, Vehicle } from '../domain/types';
import { consumptionAt, estimateFuel, routeKm, type FuelCargo } from './fuel';

function testVehicle(reeferLPerHour = 0): Vehicle {
  const v = createVehicle('eu-rigid-18', 'v');
  v.payloadKg = 10_000;
  v.fuel = { emptyLPer100km: 20, fullLPer100km: 30, idleLPerHour: 2, reeferLPerHour, tankL: 100 };
  return v;
}

function route(distances: number[], returnKm: number): Pick<Plan, 'stops' | 'meta' | 'settings'> {
  const stops: Stop[] = distances.map((km, i) => ({ id: `s${i + 1}`, name: `Stop ${i + 1}`, customerId: `c${i + 1}`, sequence: i + 1, distanceKm: km }));
  return {
    stops,
    meta: { date: '2026-01-01', time: '06:00', dock: '', route: '', returnKm, driver: '', notes: '' },
    settings: { ...defaultSettings(), avgSpeedKmh: 60, stopMinutes: 30, idleMinutesPerStop: 10, fuelPricePerL: 2, co2KgPerL: 2.5 },
  };
}

describe('consumption', () => {
  it('is linear between empty and full and extrapolates above the payload', () => {
    const p = testVehicle().fuel;
    expect(consumptionAt(p, 0, 10_000)).toBeCloseTo(20, 6);
    expect(consumptionAt(p, 5000, 10_000)).toBeCloseTo(25, 6);
    expect(consumptionAt(p, 10_000, 10_000)).toBeCloseTo(30, 6);
    expect(consumptionAt(p, 12_000, 10_000)).toBeCloseTo(32, 6);
  });
});

describe('route fuel', () => {
  const cargo: FuelCargo[] = [
    { stopSeq: 1, kg: 4000, cold: true },
    { stopSeq: 2, kg: 6000, cold: false },
  ];

  it('burns less on each leg as deliveries come off, and returns empty', () => {
    const e = estimateFuel(testVehicle(), route([10, 20], 30), cargo);
    expect(e.legs.map((l) => l.label)).toEqual(['Depot → 1', '1 → 2', '2 → Depot']);
    expect(e.legs.map((l) => l.cargoKg)).toEqual([10_000, 6000, 0]);
    expect(e.legs.map((l) => l.litres)).toEqual([3, 5.2, 6].map((x) => expect.closeTo(x, 6)));
    expect(e.km).toBe(60);
    expect(e.drivingL).toBeCloseTo(14.2, 6);
    expect(e.avgLPer100km).toBeCloseTo((14.2 / 60) * 100, 6);
    expect(e.tonneKm).toBeCloseTo(10 * 10 + 6 * 20, 6);
    expect(e.lPer100Tkm).toBeCloseTo((14.2 / 220) * 100, 6);
  });

  it('adds engine idling at each stop and reefer fuel only while cold cargo is aboard', () => {
    const e = estimateFuel(testVehicle(3), route([10, 20], 30), cargo);
    // idle: 2 L/h x 10 min x 2 stops
    expect(e.idleL).toBeCloseTo(2 * (10 / 60) * 2, 6);
    // reefer: cold cargo only until stop 1 -> 10 km at 60 km/h + 30 min at stop 1
    expect(e.reeferL).toBeCloseTo(3 * (10 / 60 + 0.5), 6);
    expect(e.totalL).toBeCloseTo(e.drivingL + e.idleL + e.reeferL, 9);
    expect(e.cost).toBeCloseTo(e.totalL * 2, 9);
    expect(e.co2Kg).toBeCloseTo(e.totalL * 2.5, 9);
    expect(e.tankShare).toBeCloseTo(e.totalL / 100, 9);
    expect(e.hours).toBeCloseTo(60 / 60 + 2 * 0.5, 9);
  });

  it('stops at the last stop with cargo for this vehicle and uses no fuel without cargo', () => {
    const partial = estimateFuel(testVehicle(), route([10, 20, 40], 30), [{ stopSeq: 1, kg: 2000, cold: false }]);
    expect(partial.legs.map((l) => l.label)).toEqual(['Depot → 1', '1 → Depot']);
    expect(partial.stopsVisited).toBe(1);
    const none = estimateFuel(testVehicle(), route([10, 20], 30), []);
    expect(none.legs).toEqual([]);
    expect(none.totalL).toBe(0);
  });

  it('sums the route length from stop legs plus the return leg', () => {
    expect(routeKm(route([18, 31, 27], 45))).toBe(121);
  });
});
