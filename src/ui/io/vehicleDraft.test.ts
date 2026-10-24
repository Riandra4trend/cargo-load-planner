import { describe, expect, it } from 'vitest';
import { createCustomVehicle, createVehicle, sliderPositions, VEHICLE_PRESETS } from '../../domain/presets';
import type { Vehicle } from '../../domain/types';
import { curvePeak, loadDistributionCurve } from '../../physics';
import { addZone, moveBulkhead, removeZone, scaleZones, validateVehicle, withStaticsType } from './vehicleDraft';

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
