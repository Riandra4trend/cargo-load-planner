import { describe, expect, it } from 'vitest';
import { createCustomVehicle, createVehicle, sliderPositions, VEHICLE_PRESETS } from '../../domain/presets';
import type { Vehicle } from '../../domain/types';
import { curvePeak, loadDistributionCurve } from '../../physics';
import {
  addZone,
  barrelLitres,
  fitCompartments,
  isAutoLayout,
  layoutCompartments,
  mergeCompartment,
  moveBulkhead,
  moveCompartment,
  moveTankBulkhead,
  removeZone,
  scaleZones,
  splitCompartment,
  validateVehicle,
  withKind,
  withStaticsType,
} from './vehicleDraft';

const errorsOf = (v: Vehicle) => validateVehicle(v, 'metric').filter((i) => i.level === 'error');

describe('vehicle editor helpers', () => {
  it('accepts every preset and the blank custom vehicle', () => {
    for (const p of VEHICLE_PRESETS) expect(errorsOf(createVehicle(p.id))).toEqual([]);
    expect(errorsOf(createCustomVehicle())).toEqual([]);
  });

  it('switches rigid <-> articulated with defaults that carry a payload', () => {
    const rigid = createCustomVehicle();
    const artic = withStaticsType({ ...rigid, cargo: { ...rigid.cargo, l: 13.6 }, zones: [{ id: 'z', temp: 'ambient', fromX: 0, toX: 13.6 }] }, 'artic');
    expect(artic.statics.type).toBe('artic');
    expect(artic.kind).toBe('semi');
    expect(errorsOf(artic)).toEqual([]);
    // The new axle layout can carry the full rated payload at some COG position.
    expect(curvePeak(loadDistributionCurve(artic)).maxKg).toBeCloseTo(artic.payloadKg, 3);

    const us = withStaticsType({ ...createVehicle('us-dry-van-53'), region: 'US' }, 'rigid');
    expect(us.statics.type).toBe('rigid');
    const back = withStaticsType({ ...us, region: 'US' }, 'artic');
    expect(back.statics.type === 'artic' && back.statics.slider).toBeTruthy();
    expect(sliderPositions(back).some((x) => back.statics.type === 'artic' && Math.abs(x - back.statics.trailerAxle.x) < 1e-6)).toBe(true);
    expect(errorsOf(back)).toEqual([]);
  });

  it('blocks bad geometry', () => {
    const rigid = createCustomVehicle();
    if (rigid.statics.type !== 'rigid') throw new Error('expected rigid');
    const noWheelbase = { ...rigid, statics: { ...rigid.statics, rear: { ...rigid.statics.rear, x: rigid.statics.front.x } } };
    expect(errorsOf(noWheelbase).some((e) => /Wheelbase/.test(e.message))).toBe(true);

    const artic = createVehicle('eu-curtainsider-136');
    if (artic.statics.type !== 'artic') throw new Error('expected artic');
    const kingpinBehind = { ...artic, statics: { ...artic.statics, kingpinX: artic.statics.trailerAxle.x + 1 } };
    expect(errorsOf(kingpinBehind).some((e) => /kingpin must be ahead/i.test(e.message))).toBe(true);
    expect(errorsOf({ ...artic, payloadKg: 0 }).some((e) => /Payload/.test(e.message))).toBe(true);
    const zeroMax = { ...artic, statics: { ...artic.statics, drive: { ...artic.statics.drive, maxKg: 0 } } };
    expect(errorsOf(zeroMax).length).toBeGreaterThan(0);
    expect(errorsOf({ ...artic, zones: [{ id: 'z', temp: 'frozen', fromX: 0, toX: artic.cargo.l }] }).some((e) => /temperature-controlled/.test(e.message))).toBe(true);
    expect(errorsOf({ ...artic, zones: [{ id: 'z', temp: 'ambient', fromX: 0, toX: 5 }] }).some((e) => /cover the full cargo length/.test(e.message))).toBe(true);
  });

  it('keeps zones contiguous and sorted while editing bulkheads', () => {
    const L = 15.7;
    const zones = createVehicle('us-reefer-53').zones;
    const moved = moveBulkhead(zones, 0, 9, L);
    expect(moved.map((z) => [z.temp, z.fromX, z.toX])).toEqual([
      ['frozen', 0, 8],
      ['chilled', 8, 9],
      ['ambient', 9, L],
    ]);
    const added = addZone(zones, L, 'frozen');
    expect(added).toHaveLength(4);
    expect(added[added.length - 1].toX).toBe(L);
    added.forEach((z, i) => i > 0 && expect(z.fromX).toBe(added[i - 1].toX));
    expect(removeZone(zones, 0, L).map((z) => [z.fromX, z.toX])).toEqual([
      [0, 8],
      [8, L],
    ]);
    expect(scaleZones(zones, L, L * 2).map((z) => z.toX)).toEqual([6, 16, L * 2]);
  });
});

describe('tanker editing', () => {
  const warningsOf = (v: Vehicle) => validateVehicle(v, 'metric').filter((i) => i.level === 'warning');

  it('creates a default tank when the body becomes a tanker and removes it again', () => {
    const rigid = createCustomVehicle();
    const tanker = withKind(rigid, 'tanker');
    const tank = tanker.tank!;
    expect(tank.compartments).toHaveLength(4);
    expect(tank.compartments.map((c) => c.label)).toEqual(['C1', 'C2', 'C3', 'C4']);
    expect(new Set(tank.compartments.map((c) => c.capacityL)).size).toBe(1);
    const total = tank.compartments.reduce((s, c) => s + c.capacityL, 0);
    expect(total).toBeLessThanOrEqual(barrelLitres(rigid) * 0.9);
    expect(total).toBeGreaterThan(barrelLitres(rigid) * 0.9 - 400);
    expect(tank.compartments[3].toX).toBe(rigid.cargo.l);
    expect(tank).toMatchObject({ baffled: false, foodGrade: false, insulated: false, pressurised: false });
    expect(isAutoLayout(tank.compartments, rigid.cargo.l)).toBe(true);
    expect(errorsOf(tanker)).toEqual([]);

    expect(withStaticsType(tanker, 'artic').tank).toEqual(tank);
    expect('tank' in withKind(tanker, 'rigid')).toBe(false);
  });

  it('splits, merges and reorders compartments, keeping them contiguous', () => {
    const v = createVehicle('tanker-semi-32k');
    const L = v.cargo.l;
    const list = v.tank!.compartments;
    const split = splitCompartment(list, L, true);
    expect(split.map((c) => c.capacityL)).toEqual([4000, 4000, 6000, 6000, 6000, 6000]);
    expect(split.map((c) => c.label)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
    expect(isAutoLayout(split, L)).toBe(true);

    const merged = mergeCompartment(list, 0, L, true);
    expect(merged.map((c) => [c.label, c.capacityL])).toEqual([
      ['C1', 14000],
      ['C2', 6000],
      ['C3', 6000],
      ['C4', 6000],
    ]);

    const moved = moveCompartment(list, 0, 1, L, false);
    expect(moved.map((c) => c.capacityL)).toEqual([6000, 8000, 6000, 6000, 6000]);
    expect(moved[0].id).toBe(list[1].id);
    expect(moved[0].toX).toBeCloseTo(list[1].toX - list[1].fromX, 3);
    moved.forEach((c, i) => i > 0 && expect(c.fromX).toBe(moved[i - 1].toX));
    expect(moved[moved.length - 1].toX).toBe(L);

    const manual = moveTankBulkhead(list, 0, 3);
    expect(manual[0].toX).toBe(3);
    expect(manual[1].fromX).toBe(3);
    expect(isAutoLayout(manual, L)).toBe(false);
    expect(fitCompartments(manual, L * 2, false)[0].toX).toBe(6);
    expect(layoutCompartments(manual, L)).toEqual(list);
  });

  it('validates compartments, labels, barrel volume and the water payload', () => {
    const v = createVehicle('tanker-rigid-16k');
    const tank = v.tank!;
    const withList = (compartments: typeof tank.compartments): Vehicle => ({ ...v, tank: { ...tank, compartments } });
    const gap = tank.compartments.map((c, i) => (i === 1 ? { ...c, fromX: c.fromX + 0.2 } : c));
    expect(errorsOf(withList(gap)).some((e) => /contiguous/.test(e.message))).toBe(true);
    const zero = tank.compartments.map((c, i) => (i === 0 ? { ...c, capacityL: 0 } : c));
    expect(errorsOf(withList(zero)).some((e) => /C1: capacity must be greater than 0/.test(e.message))).toBe(true);
    const dup = tank.compartments.map((c) => ({ ...c, label: 'C1' }));
    expect(errorsOf(withList(dup)).some((e) => /unique/.test(e.message))).toBe(true);
    const huge = tank.compartments.map((c, i) => (i === 0 ? { ...c, capacityL: 9000 } : c));
    expect(errorsOf(withList(huge)).some((e) => /C1: .* does not fit/.test(e.message))).toBe(true);
    expect(errorsOf({ ...v, tank: undefined }).some((e) => /at least one tank compartment/.test(e.message))).toBe(true);

    expect(warningsOf(v).some((w) => /full load of water/.test(w.message))).toBe(false);
    expect(warningsOf({ ...v, payloadKg: 12_000 }).some((w) => /full load of water/.test(w.message))).toBe(true);
  });
});
