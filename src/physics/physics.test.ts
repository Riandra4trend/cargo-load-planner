import { describe, expect, it } from 'vitest';
import { materialDef } from '../domain/materials';
import { createVehicle, vehicleTareKg, VEHICLE_PRESETS } from '../domain/presets';
import type { Stop, Vehicle } from '../domain/types';
import {
  bestSliderPosition,
  bridgeAllowedLb,
  computeAxleState,
  computeStages,
  curvePeak,
  loadDistributionCurve,
  maxLegalFill,
  remainingCapacity,
  withTrailerAxleX,
  type StagePoint,
} from './index';

describe('maxLegalFill', () => {
  // Tronton dump truck: 11,000 kg tare, 15,000 kg payload, 26,000 kg gross, 16,008 L body centred at 2.9 m.
  const v = createVehicle('id-dump-tronton', 'dump');
  const body = v.bulk!.compartments[0];
  const material = (id: string) => {
    const def = materialDef(id)!;
    return { materialId: def.id, state: def.state, densityKgPerL: def.densityKgPerL };
  };

  it('is weight-limited for dense material: wet sand stops at the rated payload', () => {
    const r = maxLegalFill(v, [], body, material('sand-wet'));
    expect(r.litres).toBeCloseTo(15_000 / 1.9, 6);
    expect(r.limitedBy).toBe('Payload');
  });

  it('is volume-limited for light material: coal fills the body level first', () => {
    const r = maxLegalFill(v, [], body, material('coal'));
    expect(r.litres).toBeCloseTo(16_008, 6);
    expect(r.limitedBy).toBe('Capacity');
  });

  it('counts the other cargo already aboard', () => {
    const r = maxLegalFill(v, [{ id: 'other', x: 2.9, y: 1.15, z: 0.3, kg: 10_000 }], body, material('sand-wet'));
    expect(r.litres).toBeCloseTo(5000 / 1.9, 6);
  });
});

const TOL = 2; // toBeCloseTo digits => |diff| < 0.005 kg

function rigidTestVehicle(): Vehicle {
  const v = createVehicle('eu-rigid-18', 'rigid-test');
  if (v.statics.type !== 'rigid') throw new Error('expected rigid');
  v.statics.front = { ...v.statics.front, x: -1.0, tareKg: 0 };
  v.statics.rear = { ...v.statics.rear, x: 4.0, tareKg: 0 };
  return v;
}

function articTestVehicle(): Vehicle {
  const v = createVehicle('eu-curtainsider-136', 'artic-test');
  if (v.statics.type !== 'artic') throw new Error('expected artic');
  v.statics.kingpinX = 1.0;
  v.statics.trailerAxle = { ...v.statics.trailerAxle, x: 11.0 };
  v.statics.trailerTareKg = 0;
  v.statics.steer = { ...v.statics.steer, x: 0, tareKg: 0 };
  v.statics.drive = { ...v.statics.drive, x: 3.8, tareKg: 0 };
  v.statics.fifthWheelX = 3.5;
  return v;
}

const point = (x: number, kg = 1000) => ({ id: `p${x}`, x, y: 1.2, z: 0.5, kg });

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('rigid vehicle statics', () => {
  it('splits a 1000 kg load between the axles by lever arm, including behind the rear axle', () => {
    const v = rigidTestVehicle();
    const at = (x: number) => computeAxleState(v, [point(x)]).axles.map((a) => a.kg);
    const [f2, r2] = at(2.0);
    expect(f2).toBeCloseTo(400, TOL);
    expect(r2).toBeCloseTo(600, TOL);
    const [f3, r3] = at(3.0);
    expect(f3).toBeCloseTo(200, TOL);
    expect(r3).toBeCloseTo(800, TOL);
    const [f6, r6] = at(6.0);
    expect(f6).toBeCloseTo(-400, TOL);
    expect(r6).toBeCloseTo(1400, TOL);
  });
});

describe('articulated vehicle statics', () => {
  it('resolves trailer loads through the kingpin onto steer and drive axles', () => {
    const v = articTestVehicle();
    const st = computeAxleState(v, [point(5.0)]);
    const [steer, drive, trailer] = st.axles.map((a) => a.kg);
    expect(trailer).toBeCloseTo(400, TOL);
    expect(st.kingpinKg).toBeCloseTo(600, TOL);
    expect(steer).toBeCloseTo(47.37, TOL);
    expect(drive).toBeCloseTo(552.63, TOL);
  });
});

describe('conservation of weight', () => {
  it('sum of axle loads equals tare plus cargo for every preset and random plans', () => {
    const rand = rng(7);
    for (const preset of VEHICLE_PRESETS) {
      const v = createVehicle(preset.id, preset.id);
      for (let trial = 0; trial < 20; trial++) {
        const pts = Array.from({ length: 1 + Math.floor(rand() * 30) }, (_, i) => ({
          id: `u${i}`,
          x: rand() * v.cargo.l,
          y: rand() * v.cargo.w,
          z: rand() * v.cargo.h,
          kg: 50 + rand() * 1500,
        }));
        const st = computeAxleState(v, pts);
        const cargo = pts.reduce((s, p) => s + p.kg, 0);
        const sum = st.axles.reduce((s, a) => s + a.kg, 0);
        expect(sum).toBeCloseTo(vehicleTareKg(v) + cargo, TOL);
        expect(st.grossKg).toBeCloseTo(vehicleTareKg(v) + cargo, TOL);
      }
    }
  });
});

describe('vehicle presets', () => {
  it.each(VEHICLE_PRESETS.map((p) => [p.id]))('%s carries its effective payload legally at the best COG and not at the rear wall', (id) => {
    const v = createVehicle(id, id);
    const effective = Math.min(v.payloadKg, v.grossLimitKg - vehicleTareKg(v));
    const curve = loadDistributionCurve(v);
    const peak = curvePeak(curve);
    if (v.payloadKg <= v.grossLimitKg - vehicleTareKg(v)) {
      // not road-limited: the full rated payload must fit legally
      expect(peak.maxKg).toBeGreaterThanOrEqual(v.payloadKg - 1);
    } else {
      // road-limited (container rating above the road gross): within 3 % of the gross-limited payload
      expect(peak.maxKg).toBeGreaterThanOrEqual(0.97 * effective);
    }
    // verify the peak independently: the full peak payload placed at the peak COG is legal
    const st = computeAxleState(v, [{ id: 'all', x: peak.x, y: v.cargo.w / 2, z: 1, kg: peak.maxKg - 1 }]);
    expect(st.axles.every((a) => a.kg <= a.maxKg + 0.5 && a.kg >= a.minKg - 0.5)).toBe(true);
    // everything at the rear wall: the legal payload drops clearly below the peak
    expect(curve[curve.length - 1].maxKg).toBeLessThan(0.95 * peak.maxKg);
    const rear = computeAxleState(v, [{ id: 'all', x: v.cargo.l, y: v.cargo.w / 2, z: 1, kg: effective }]);
    expect(rear.status === 'over' || rear.status === 'under').toBe(true);
  });
});

describe('unloading stages', () => {
  it('after stop 1 the axle loads equal a fresh computation of the remaining units', () => {
    const v = createVehicle('us-reefer-53', 'reefer');
    const stops: Stop[] = [1, 2, 3].map((seq) => ({ id: `s${seq}`, name: `Stop ${seq}`, customerId: `c${seq}`, sequence: seq }));
    const pts: StagePoint[] = [
      { id: 'a', x: 1.0, y: 1.2, z: 0.7, kg: 900, stopSeq: 3 },
      { id: 'b', x: 6.0, y: 0.6, z: 0.7, kg: 1200, stopSeq: 2 },
      { id: 'c', x: 13.0, y: 1.8, z: 0.7, kg: 1500, stopSeq: 1 },
      { id: 'd', x: 14.5, y: 1.2, z: 0.7, kg: 700, stopSeq: 1 },
    ];
    const stages = computeStages(v, stops, pts);
    expect(stages.map((s) => s.label)).toEqual(['Depart', 'After 1', 'After 2']);
    const fresh = computeAxleState(v, pts.filter((p) => p.stopSeq > 1));
    stages[1].axle.axles.forEach((a, i) => expect(a.kg).toBeCloseTo(fresh.axles[i].kg, TOL));
    expect(stages[1].unitIds).toEqual(['a', 'b']);
    expect(stages[2].unitIds).toEqual(['a']);
  });
});

describe('remaining capacity', () => {
  it('names the binding limit and is zero when an axle is already over', () => {
    const v = createVehicle('eu-rigid-18', 'rigid');
    const light = computeAxleState(v, [{ id: 'x', x: 3.0, y: 1.2, z: 1, kg: 2000 }]);
    const r = remainingCapacity(v, light);
    expect(r.kg).toBeGreaterThan(0);
    expect(r.kg).toBeLessThanOrEqual(v.payloadKg - 2000 + 1e-6);
    const overloaded = computeAxleState(v, [{ id: 'x', x: 7.0, y: 1.2, z: 1, kg: 6000 }]);
    expect(overloaded.axles[1].status).toBe('over');
    const r2 = remainingCapacity(v, overloaded);
    expect(r2.kg).toBe(0);
    expect(r2.limitedBy).toBe('Rear axle');
  });
});

describe('US Federal Bridge Formula', () => {
  it('matches known values', () => {
    expect(bridgeAllowedLb(51, 5)).toBe(80_000);
    expect(bridgeAllowedLb(36, 4)).toBe(66_000);
  });
});

describe('sliding tandem', () => {
  it('picks a hole that relieves an overloaded drive axle', () => {
    const v = createVehicle('us-reefer-53', 'reefer');
    if (v.statics.type !== 'artic' || !v.statics.slider) throw new Error('expected slider');
    const rearMost = v.statics.slider.minX + (v.statics.slider.holes - 1) * v.statics.slider.step;
    const pts = [{ id: 'front-heavy', x: 5.4, y: 1.2, z: 0.8, kg: 17_380 }];
    const bad = computeAxleState(withTrailerAxleX(v, rearMost), pts);
    expect(bad.axles[1].status).toBe('over');
    const best = bestSliderPosition(withTrailerAxleX(v, rearMost), [pts]);
    expect(best).not.toBeNull();
    const fixed = computeAxleState(withTrailerAxleX(v, best!.x), pts);
    expect(fixed.axles.every((a) => a.status !== 'over')).toBe(true);
  });
});
