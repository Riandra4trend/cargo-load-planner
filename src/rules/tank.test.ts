import { describe, expect, it } from 'vitest';
import { createTankerSeedPlan, makeBulkLiquidSpec, makeSpec } from '../data/seed';
import { createVehicle } from '../domain/presets';
import { buildHazmatMatrix, defaultSettings } from '../domain/settings';
import type { ItemSpec, Placement, Plan, Violation, ViolationKind } from '../domain/types';
import { evaluatePlan } from '../state/evaluate';
import { validateMove } from '.';
import { withCompartment } from './tank';

interface Fill {
  key: string;
  spec: ItemSpec;
  /** Compartment id, or a floor position for packaged units / misplaced fills. */
  at: string | { x: number; y: number; z: number };
  stop?: number;
}

const bulk = (liquidId: string, litres: number, partial: Partial<ItemSpec> = {}) => makeBulkLiquidSpec(liquidId, litres, partial);

/** One vehicle, one single-unit line per fill; unit ids are `${key}#0`. */
function planWith(presetId: string, fills: Fill[], tweak?: (p: Plan) => void): Plan {
  const vehicle = createVehicle(presetId, 'v1');
  const stops = [1, 2, 3].map((n) => ({ id: `s${n}`, name: `Stop ${n}`, customerId: `c${n}`, sequence: n }));
  const placements: Record<string, Placement> = {};
  for (const f of fills) {
    const id = `${f.key}#0`;
    if (typeof f.at === 'string') {
      const c = vehicle.tank?.compartments.find((x) => x.id === f.at);
      placements[id] = { unitId: id, vehicleId: 'v1', compartmentId: f.at, pos: { x: c?.fromX ?? 0, y: 0, z: 0 }, orient: 0 };
    } else {
      placements[id] = { unitId: id, vehicleId: 'v1', pos: f.at, orient: 0 };
    }
  }
  const plan: Plan = {
    version: 1,
    id: 'test',
    name: 'Test',
    meta: { date: '2026-01-01', time: '06:00', dock: '', route: '', returnKm: 0, driver: '', notes: '' },
    customers: stops.map((s) => ({ id: s.customerId, name: s.name, color: '#000000' })),
    stops,
    lines: fills.map((f) => ({ id: f.key, spec: f.spec, quantity: 1, stopId: `s${f.stop ?? 1}`, priority: 'normal' })),
    vehicles: [vehicle],
    placements,
    settings: defaultSettings(),
  };
  tweak?.(plan);
  return plan;
}

const kinds = (plan: Plan, kind: ViolationKind): Violation[] => evaluatePlan(plan).violations.filter((v) => v.kind === kind);
const tank = (plan: Plan): string[] => kinds(plan, 'tank').map((v) => v.message);

describe('tanker hard rules', () => {
  it('a: bulk fills only go into tanker compartments', () => {
    expect(tank(planWith('tanker-semi-32k', [{ key: 'd', spec: bulk('diesel', 5000), at: 'c1' }]))).toEqual([]);
    expect(tank(planWith('eu-rigid-18', [{ key: 'd', spec: bulk('diesel', 5000), at: { x: 0, y: 0, z: 0 } }]))).toEqual([
      'Diesel (solar): bulk liquid goes into a tanker compartment',
    ]);
    expect(tank(planWith('tanker-semi-32k', [{ key: 'd', spec: bulk('diesel', 5000), at: 'c9' }]))).toEqual(['Diesel (solar): bulk liquid goes into a tanker compartment']);
  });

  it('b: a tanker carries no packaged units', () => {
    const pallet = makeSpec({ name: 'Pallet', dims: { l: 1.2, w: 0.8, h: 1 }, weightKg: 300 });
    expect(tank(planWith('tanker-semi-32k', [{ key: 'p', spec: pallet, at: { x: 0, y: 0, z: 0 } }]))).toEqual(['Pallet: a tanker only carries bulk liquid']);
    expect(tank(planWith('eu-rigid-18', [{ key: 'p', spec: pallet, at: { x: 0, y: 0, z: 0 } }]))).toEqual([]);
  });

  it('c: one fill per compartment', () => {
    const two = (c2: string) => planWith('tanker-semi-32k', [
      { key: 'a', spec: bulk('diesel', 3000), at: 'c2' },
      { key: 'b', spec: bulk('gasoline', 3000), at: c2 },
    ]);
    expect(tank(two('c3'))).toEqual([]);
    const same = kinds(two('c2'), 'tank');
    expect(same.map((v) => v.message)).toEqual(['Diesel (solar) and Gasoline (bensin) are both in C2']);
    expect(same[0].unitIds.sort()).toEqual(['a#0', 'b#0']);
  });

  it('d: max fill boundary (97 % for diesel)', () => {
    expect(tank(planWith('tanker-semi-32k', [{ key: 'd', spec: bulk('diesel', 7760), at: 'c1' }]))).toEqual([]);
    const over = kinds(planWith('tanker-semi-32k', [{ key: 'd', spec: bulk('diesel', 7761), at: 'c1' }]), 'tank');
    expect(over.map((v) => v.message)).toEqual(['Diesel (solar) 7,761 L overfills C1: max 7,760 L (97 % of 8,000 L)']);
    expect(over[0].unitIds).toEqual(['d#0']);
  });

  it('d: suggests a free compartment that is large enough', () => {
    const plan = planWith('tanker-semi-32k', [
      { key: 'd', spec: bulk('diesel', 5900), at: 'c2' },
      { key: 'g', spec: bulk('gasoline', 1000), at: 'c3' },
    ]);
    const over = kinds(plan, 'tank')[0];
    expect(over.fix?.action).toEqual({ type: 'compartment', unitId: 'd#0', vehicleId: 'v1', compartmentId: 'c1' });
    expect(over.fix?.label).toBe('Move Diesel (solar) to C1');
  });

  it('e: food needs a food-grade tank and must not share it with non-food', () => {
    expect(tank(planWith('tanker-water-8k', [{ key: 'w', spec: bulk('drinking-water', 7000), at: 'c1' }]))).toEqual([]);
    expect(tank(planWith('tanker-semi-32k', [{ key: 'w', spec: bulk('drinking-water', 5000), at: 'c2' }]))).toEqual([
      'Drinking water is a foodstuff: Fuel tanker 32,000 L (semi-trailer) does not have a food-grade tank',
    ]);
    const mixed = (other: string) =>
      planWith('tanker-food-24k', [
        { key: 'a', spec: bulk('palm-oil', 7000), at: 'c1' },
        { key: 'b', spec: bulk(other, 7000), at: 'c3' },
      ]);
    expect(tank(mixed('vegetable-oil'))).toEqual([]);
    expect(tank(mixed('water'))).toEqual(['Food Palm oil (CPO) and non-food Water share a food-grade tank']);
  });

  it('f: chilled bulk liquid needs an insulated tank', () => {
    expect(tank(planWith('tanker-food-24k', [{ key: 'm', spec: bulk('milk', 7000), at: 'c1' }]))).toEqual([]);
    expect(tank(planWith('tanker-water-8k', [{ key: 'm', spec: bulk('milk', 7000), at: 'c1' }]))).toEqual(['Milk is chilled: it needs an insulated tank']);
  });

  it('pressure vessels carry liquefied gas only', () => {
    expect(tank(planWith('tanker-lpg-44k', [{ key: 'l', spec: bulk('lpg', 37_400), at: 'c1' }]))).toEqual([]);
    expect(tank(planWith('tanker-semi-32k', [{ key: 'l', spec: bulk('lpg', 5000), at: 'c2' }]))).toEqual(['LPG (liquefied, pressurised) needs a pressurised tank']);
    expect(tank(planWith('tanker-lpg-44k', [{ key: 'd', spec: bulk('diesel', 20_000), at: 'c1' }]))).toEqual(['Diesel (solar) cannot go into a pressurised tank']);
  });

  it('g: hazmat never together, separate not in adjacent compartments', () => {
    const toxicGas = bulk('diesel', 3000, { name: 'Toxic liquid', hazmat: { unNumber: 'UN0000', hazClass: '2.3' } });
    const never = planWith('tanker-semi-32k', [
      { key: 'a', spec: toxicGas, at: 'c1' },
      { key: 'b', spec: bulk('gasoline', 3000), at: 'c5' },
    ]);
    expect(tank(never)).toEqual(['Toxic liquid and Gasoline (bensin) must not travel in one tanker (hazmat classes 2.3 / 3)']);
    const separate = (c: string) =>
      planWith(
        'tanker-semi-32k',
        [
          { key: 'a', spec: bulk('diesel', 5000), at: 'c2' },
          { key: 'b', spec: bulk('sulfuric-acid', 3000), at: c },
        ],
        (p) => {
          p.settings.hazmatMatrix = buildHazmatMatrix([['3', '8', 'separate']]);
        },
      );
    expect(tank(separate('c4'))).toEqual([]);
    expect(tank(separate('c3'))).toEqual(['Diesel (solar) (C2) and Sulfuric acid 98 % (C3) must not be in adjacent compartments (hazmat classes 3 / 8)']);
  });

  it('h: packaged liquid within its container capacity', () => {
    const drum = (volumeL: number) =>
      makeSpec({ name: 'Diesel drum', packaging: 'drum', dims: { l: 0.6, w: 0.6, h: 0.9 }, weightKg: 200, liquid: { liquidId: 'diesel', name: 'Diesel (solar)', densityKgPerL: 0.84, volumeL } });
    // Drum brim capacity 216 L, diesel max fill 97 % = 209.52 L.
    expect(tank(planWith('eu-rigid-18', [{ key: 'd', spec: drum(209.52), at: { x: 0, y: 0, z: 0 } }]))).toEqual([]);
    expect(tank(planWith('eu-rigid-18', [{ key: 'd', spec: drum(210), at: { x: 0, y: 0, z: 0 } }]))).toEqual(['Diesel drum: 210.0 L overfills its container: max 209.5 L (97 % of 216 L)']);
    const custom = (volumeL: number) =>
      makeSpec({ name: 'Can', dims: { l: 0.5, w: 0.5, h: 0.5 }, weightKg: 90, liquid: { liquidId: 'diesel', name: 'Diesel (solar)', densityKgPerL: 0.84, volumeL, containerCapacityL: 100 } });
    expect(tank(planWith('eu-rigid-18', [{ key: 'c', spec: custom(97), at: { x: 0, y: 0, z: 0 } }]))).toEqual([]);
    expect(tank(planWith('eu-rigid-18', [{ key: 'c', spec: custom(97.5), at: { x: 0, y: 0, z: 0 } }]))).toHaveLength(1);
  });

  it('bulk fills take no part in geometric checks', () => {
    const plan = planWith('tanker-semi-32k', [
      { key: 'a', spec: bulk('diesel', 7700), at: 'c1' },
      { key: 'b', spec: bulk('diesel', 5800), at: 'c2', stop: 2 },
      { key: 'c', spec: bulk('gasoline', 5800), at: 'c3', stop: 3 },
    ]);
    for (const p of Object.values(plan.placements)) p.pos = { x: 0, y: 0, z: 3 };
    const geometric: ViolationKind[] = ['bounds', 'overlap', 'support', 'stacking', 'fragile', 'ceiling', 'door', 'temperature', 'lifo', 'floor-load', 'hazmat'];
    expect(evaluatePlan(plan).violations.filter((v) => geometric.includes(v.kind))).toEqual([]);
  });
});

describe('surge', () => {
  it('flags unbaffled partial fills between 20 % and 80 % only', () => {
    const one = (litres: number) => kinds(planWith('tanker-semi-32k', [{ key: 'd', spec: bulk('diesel', litres), at: 'c2' }]), 'surge');
    expect(one(4800)).toEqual([]);
    expect(one(1200)).toEqual([]);
    const s = one(3180);
    expect(s.map((v) => v.message)).toEqual(['C2 is 53 % full: liquid surge when braking; fill it above 80 % or use a smaller compartment']);
    expect(s[0].severity).toBe('warning');
    expect(s[0].hard).toBe(false);
  });

  it('never on a baffled tank', () => {
    expect(kinds(planWith('tanker-food-24k', [{ key: 'm', spec: bulk('milk', 4000), at: 'c1' }]), 'surge')).toEqual([]);
  });

  it('suggests a free compartment where the fill is at least 80 %', () => {
    const plan = planWith('tanker-rigid-16k', [{ key: 'd', spec: bulk('diesel', 3300), at: 'c1' }]);
    // 4 x 4,000 L: 3,300 L is 82.5 % anywhere, so no surge to begin with.
    expect(kinds(plan, 'surge')).toEqual([]);
    const semi = planWith('tanker-semi-32k', [{ key: 'd', spec: bulk('diesel', 5000), at: 'c1' }]);
    const s = kinds(semi, 'surge')[0];
    expect(s.fix?.action).toEqual({ type: 'compartment', unitId: 'd#0', vehicleId: 'v1', compartmentId: 'c2' });
  });
});

describe('tanker seed', () => {
  it('reports the axle problems with a compartment fix that clears them', () => {
    const plan = createTankerSeedPlan();
    const ev = evaluatePlan(plan);
    const axle = ev.violations.filter((v) => v.kind === 'axle-max' || v.kind === 'axle-min');
    expect(axle.length).toBeGreaterThanOrEqual(1);
    expect(ev.violations.filter((v) => v.hard)).toEqual([]);
    expect(ev.violations.filter((v) => v.kind === 'surge')).toHaveLength(1);
    const fix = axle.find((v) => v.fix)?.fix;
    expect(fix?.action.type).toBe('compartment');
    if (fix?.action.type !== 'compartment') return;
    const v = plan.vehicles[0];
    const { unitId, compartmentId } = fix.action;
    const c = v.tank!.compartments.find((x) => x.id === compartmentId)!;
    const fixed = { ...plan, placements: withCompartment(plan.placements, unitId, v, c) };
    const after = evaluatePlan(fixed).violations;
    expect(after.filter((x) => x.kind === 'axle-max' || x.kind === 'axle-min')).toEqual([]);
    expect(after.filter((x) => x.hard)).toEqual([]);
  });
});

describe('validateMove for bulk fills', () => {
  const plan = createTankerSeedPlan();
  const into = (unitId: string, compartmentId: string, vehicleId = 'veh-1'): Placement => ({ unitId, vehicleId, compartmentId, pos: { x: 0, y: 0, z: 0 }, orient: 0 });

  it('accepts a swap when both fills fit', () => {
    expect(validateMove(plan, into('line-gasoline-1#0', 'c5'))).toEqual({ ok: true, reasons: [] });
  });

  it('rejects a swap when the occupant would not fit the old compartment', () => {
    const r = validateMove(plan, into('line-diesel-3#0', 'c1'));
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(['Diesel (solar) 7,700 L would not fit C5 after the swap']);
  });

  it('rejects an overfill and names the limit', () => {
    const r = validateMove(plan, into('line-diesel-1#0', 'c5'));
    expect(r.reasons[0]).toBe('7,700 L overfills C5: max 5,820 L (97 % of 6,000 L)');
  });

  it('lets a fill from outside take an occupied compartment (the occupant is unloaded)', () => {
    const unloaded = { ...plan, placements: { ...plan.placements } };
    delete unloaded.placements['line-diesel-3#0'];
    expect(validateMove(unloaded, into('line-diesel-3#0', 'c2')).ok).toBe(true);
  });

  it('bulk only into compartments, tankers only bulk', () => {
    const mixed: Plan = {
      ...plan,
      vehicles: [...plan.vehicles, createVehicle('eu-rigid-18', 'rigid')],
      lines: [...plan.lines, { id: 'pallet', spec: makeSpec({ name: 'Pallet', dims: { l: 1.2, w: 0.8, h: 1 }, weightKg: 300 }), quantity: 1, stopId: 'stop-1', priority: 'normal' }],
    };
    expect(validateMove(mixed, { unitId: 'line-diesel-3#0', vehicleId: 'rigid', pos: { x: 0, y: 0, z: 0 }, orient: 0 }).reasons).toEqual(['Bulk liquid goes into a tanker compartment']);
    expect(validateMove(mixed, { unitId: 'line-diesel-3#0', vehicleId: 'veh-1', pos: { x: 0, y: 0, z: 0 }, orient: 0 }).reasons).toEqual(['Bulk liquid goes into a tanker compartment']);
    expect(validateMove(mixed, { unitId: 'pallet#0', vehicleId: 'veh-1', pos: { x: 0, y: 0, z: 0 }, orient: 0 }).reasons).toEqual(['A tanker only carries bulk liquid']);
    expect(validateMove(mixed, { unitId: 'pallet#0', vehicleId: 'rigid', pos: { x: 0, y: 0, z: 0 }, orient: 0 }).ok).toBe(true);
  });

  it('checks food grade, insulation and pressure of the target tank', () => {
    const milk = planWith('tanker-semi-32k', [{ key: 'm', spec: bulk('milk', 5000), at: 'c2' }]);
    expect(validateMove(milk, into('m#0', 'c3', 'v1')).reasons).toEqual(['Needs a food-grade tank', 'Needs an insulated tank']);
  });
});
