import { describe, expect, it } from 'vitest';
import { createSeedPlan, makeSpec } from '../data/seed';
import { expandUnits } from '../domain/geometry';
import { createVehicle } from '../domain/presets';
import { defaultSettings } from '../domain/settings';
import type { ItemSpec, Orientation, Placement, Plan, Vec3, Violation, ViolationKind } from '../domain/types';
import { evaluatePlan } from '../state/evaluate';
import { checkPlan, validateMove, type VehiclePhysics } from '.';

interface Item {
  key: string;
  spec: ItemSpec;
  stop?: number;
  pos: Vec3;
  orient?: Orientation;
}

const pallet = (partial: Partial<ItemSpec> = {}): ItemSpec =>
  makeSpec({ name: 'Pallet', dims: { l: 1.2, w: 0.8, h: 1.0 }, weightKg: 300, stackable: true, maxLoadOnTopKg: 1000, maxStackLayers: 3, ...partial });

/** Plan with one vehicle and one single-unit line per item; unit ids are `${key}#0`. */
function planWith(presetId: string, items: Item[], tweak?: (p: Plan) => void): Plan {
  const vehicle = createVehicle(presetId, 'v1');
  const stops = [1, 2, 3].map((n) => ({ id: `s${n}`, name: `Stop ${n}`, customerId: `c${n}`, sequence: n }));
  const placements: Record<string, Placement> = {};
  for (const it of items) placements[`${it.key}#0`] = { unitId: `${it.key}#0`, vehicleId: 'v1', pos: it.pos, orient: it.orient ?? 0 };
  const plan: Plan = {
    version: 1,
    id: 'test',
    name: 'Test',
    meta: { date: '2026-01-01', time: '06:00', dock: '', route: '', distanceKm: 0, driver: '', notes: '' },
    customers: stops.map((s) => ({ id: s.customerId, name: s.name, color: '#000000' })),
    stops,
    lines: items.map((it) => ({ id: it.key, spec: { ...it.spec, name: it.spec.name === 'Pallet' ? it.key : it.spec.name }, quantity: 1, stopId: `s${it.stop ?? 1}`, priority: 'normal' })),
    vehicles: [vehicle],
    placements,
    settings: defaultSettings(),
  };
  tweak?.(plan);
  return plan;
}

const kinds = (plan: Plan, kind: ViolationKind): Violation[] => evaluatePlan(plan).violations.filter((v) => v.kind === kind);

describe('LIFO', () => {
  const items: Item[] = [
    { key: 'early', spec: pallet(), stop: 1, pos: { x: 0, y: 0, z: 0 } },
    { key: 'late', spec: pallet(), stop: 2, pos: { x: 1.3, y: 0, z: 0 } },
  ];

  it('flags a later-stop unit between an earlier stop and the rear doors', () => {
    const lifo = kinds(planWith('eu-rigid-18', items), 'lifo');
    expect(lifo).toHaveLength(1);
    expect(lifo[0].message).toContain('blocks stop 1');
    expect(lifo[0].message).toBe('late (stop 2) blocks stop 1');
    expect(lifo[0].unitIds).toEqual(['late#0', 'early#0']);
    expect(lifo[0].hard).toBe(false);
  });

  it('ignores door blocking on side-access vehicles', () => {
    expect(kinds(planWith('eu-curtainsider-136', items), 'lifo')).toHaveLength(0);
  });

  it('flags stacking a later stop on an earlier stop on any vehicle', () => {
    const stacked: Item[] = [
      { key: 'early', spec: pallet(), stop: 1, pos: { x: 0, y: 0, z: 0 } },
      { key: 'late', spec: pallet(), stop: 2, pos: { x: 0, y: 0, z: 1.0 } },
    ];
    const lifo = kinds(planWith('eu-curtainsider-136', stacked), 'lifo');
    expect(lifo).toHaveLength(1);
    expect(lifo[0].message).toContain('blocks stop 1');
  });

  it('suggests moving the blocker to a free spot nearer the front', () => {
    const lifo = kinds(planWith('eu-rigid-18', items), 'lifo')[0];
    expect(lifo.fix?.action.type).toBe('move');
    if (lifo.fix?.action.type !== 'move') return;
    expect(lifo.fix.action.pos.x).toBeLessThan(1.3);
    expect(lifo.fix.label).toMatch(/^Move late .* forward$/);
  });
});

describe('hard constraints', () => {
  const base = { key: 'bottom', spec: pallet(), pos: { x: 0, y: 0, z: 0 } };

  it('support: full support passes, a large overhang fails', () => {
    expect(kinds(planWith('eu-rigid-18', [base, { key: 'top', spec: pallet(), pos: { x: 0, y: 0, z: 1.0 } }]), 'support')).toHaveLength(0);
    const bad = kinds(planWith('eu-rigid-18', [base, { key: 'top', spec: pallet(), pos: { x: 0.6, y: 0, z: 1.0 } }]), 'support');
    expect(bad).toHaveLength(1);
    expect(bad[0].unitIds[0]).toBe('top#0');
    expect(bad[0].message).toContain('supported');
  });

  it('support: centre of gravity over the unsupported part fails', () => {
    const heavyEnd = pallet({ cogOffset: { x: 0.55, y: 0, z: 0 } });
    // 0.2 m overhang: 83 % supported, but the COG (x = 0.2 + 0.6 + 0.55 = 1.35) lies beyond the support (x <= 1.2).
    const bad = kinds(planWith('eu-rigid-18', [base, { key: 'top', spec: heavyEnd, pos: { x: 0.2, y: 0, z: 1.0 } }]), 'support');
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain('centre of gravity');
  });

  it('stacking: load on top within and above the rating', () => {
    const rated = { ...base, spec: pallet({ maxLoadOnTopKg: 500 }) };
    expect(kinds(planWith('eu-rigid-18', [rated, { key: 'top', spec: pallet({ weightKg: 400 }), pos: { x: 0, y: 0, z: 1.0 } }]), 'stacking')).toHaveLength(0);
    const bad = kinds(planWith('eu-rigid-18', [rated, { key: 'top', spec: pallet({ weightKg: 600 }), pos: { x: 0, y: 0, z: 1.0 } }]), 'stacking');
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toBe('Load on bottom: 600 / 500 kg');
    expect(bad[0].unitIds).toEqual(['bottom#0', 'top#0']);
  });

  it('stacking: load is transitive through the stack', () => {
    const items: Item[] = [
      { key: 'a', spec: pallet({ maxLoadOnTopKg: 500, dims: { l: 1.2, w: 0.8, h: 0.6 } }), pos: { x: 0, y: 0, z: 0 } },
      { key: 'b', spec: pallet({ weightKg: 300, dims: { l: 1.2, w: 0.8, h: 0.6 } }), pos: { x: 0, y: 0, z: 0.6 } },
      { key: 'c', spec: pallet({ weightKg: 300, dims: { l: 1.2, w: 0.8, h: 0.6 } }), pos: { x: 0, y: 0, z: 1.2 } },
    ];
    const bad = kinds(planWith('eu-rigid-18', items), 'stacking');
    expect(bad.map((v) => v.message)).toEqual(['Load on a: 600 / 500 kg']);
  });

  it('stacking: layer limits of the unit and of every unit below it', () => {
    const low = (h: number) => pallet({ dims: { l: 1.2, w: 0.8, h } });
    const two = [base, { key: 'l2', spec: low(0.5), pos: { x: 0, y: 0, z: 1.0 } }];
    expect(kinds(planWith('eu-rigid-18', two), 'stacking')).toHaveLength(0);
    const limited = { ...base, spec: pallet({ maxStackLayers: 2 }) };
    const three = [limited, { key: 'l2', spec: low(0.5), pos: { x: 0, y: 0, z: 1.0 } }, { key: 'l3', spec: low(0.5), pos: { x: 0, y: 0, z: 1.5 } }];
    const bad = kinds(planWith('eu-rigid-18', three), 'stacking');
    expect(bad).toHaveLength(1);
    expect(bad[0].unitIds).toEqual(['l3#0', 'bottom#0']);
    expect(bad[0].message).toContain('layer 3');
  });

  it('stacking: resting on a non-stackable unit fails', () => {
    const items = [{ ...base, spec: pallet({ stackable: false }) }, { key: 'top', spec: pallet(), pos: { x: 0, y: 0, z: 1.0 } }];
    const bad = kinds(planWith('eu-rigid-18', items), 'stacking');
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toBe('top rests on bottom, which is not stackable');
  });

  it('fragile: nothing may rest on a fragile unit', () => {
    const top = { key: 'top', spec: pallet(), pos: { x: 0, y: 0, z: 1.0 } };
    expect(kinds(planWith('eu-rigid-18', [base, top]), 'fragile')).toHaveLength(0);
    const bad = kinds(planWith('eu-rigid-18', [{ ...base, spec: pallet({ fragile: true }) }, top]), 'fragile');
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toBe('top rests on fragile bottom');
    expect(bad[0].unitIds).toEqual(['top#0', 'bottom#0']);
  });

  it('rotation: orientations outside the rotation rule fail', () => {
    const fixed = pallet({ rotation: 'none' });
    expect(kinds(planWith('eu-rigid-18', [{ key: 'u', spec: fixed, pos: { x: 0, y: 0, z: 0 }, orient: 0 }]), 'rotation')).toHaveLength(0);
    expect(kinds(planWith('eu-rigid-18', [{ key: 'u', spec: fixed, pos: { x: 0, y: 0, z: 0 }, orient: 1 }]), 'rotation')).toHaveLength(1);
    const upright = pallet({ rotation: 'any', keepUpright: true });
    expect(kinds(planWith('eu-rigid-18', [{ key: 'u', spec: upright, pos: { x: 0, y: 0, z: 0 }, orient: 2 }]), 'rotation')).toHaveLength(1);
  });

  it('door: the placed cross-section must pass the rear door of rear-only vehicles', () => {
    const wide = pallet({ dims: { l: 2.42, w: 1.0, h: 1.0 } });
    // Box truck door 2.40 m wide: lengthwise passes, crosswise (2.42 m across) does not.
    expect(kinds(planWith('eu-rigid-18', [{ key: 'u', spec: wide, pos: { x: 0, y: 0, z: 0 }, orient: 0 }]), 'door')).toHaveLength(0);
    expect(kinds(planWith('eu-rigid-18', [{ key: 'u', spec: wide, pos: { x: 0, y: 0, z: 0 }, orient: 1 }]), 'door')).toHaveLength(1);
    // Side access: no door check.
    expect(kinds(planWith('eu-curtainsider-136', [{ key: 'u', spec: wide, pos: { x: 0, y: 0, z: 0 }, orient: 1 }]), 'door')).toHaveLength(0);
  });

  it('temperature: zones of the unit class; dry vehicles carry ambient only', () => {
    const chilled = pallet({ temp: 'chilled' });
    // Reefer preset zones: frozen 0-3, chilled 3-8, ambient 8-15.7.
    expect(kinds(planWith('us-reefer-53', [{ key: 'u', spec: chilled, pos: { x: 3.5, y: 0, z: 0 } }]), 'temperature')).toHaveLength(0);
    expect(kinds(planWith('us-reefer-53', [{ key: 'u', spec: chilled, pos: { x: 9, y: 0, z: 0 } }]), 'temperature')).toHaveLength(1);
    expect(kinds(planWith('us-reefer-53', [{ key: 'u', spec: chilled, pos: { x: 7.5, y: 0, z: 0 } }]), 'temperature')).toHaveLength(1);
    const dry = kinds(planWith('eu-rigid-18', [{ key: 'u', spec: chilled, pos: { x: 0, y: 0, z: 0 } }]), 'temperature');
    expect(dry).toHaveLength(1);
    expect(dry[0].message).toContain('temperature-controlled');
    expect(kinds(planWith('eu-rigid-18', [{ key: 'u', spec: pallet(), pos: { x: 0, y: 0, z: 0 } }]), 'temperature')).toHaveLength(0);
  });

  it('hazmat: never together', () => {
    const toxicGas = pallet({ hazmat: { unNumber: 'UN1005', hazClass: '2.3' } });
    const flammable = pallet({ hazmat: { unNumber: 'UN1263', hazClass: '3' } });
    const misc = pallet({ hazmat: { unNumber: 'UN3480', hazClass: '9' } });
    const far = (spec: ItemSpec): Item => ({ key: 'b', spec, pos: { x: 6, y: 1.6, z: 0 } });
    const a: Item = { key: 'a', spec: toxicGas, pos: { x: 0, y: 0, z: 0 } };
    const bad = kinds(planWith('eu-rigid-18', [a, far(flammable)]), 'hazmat');
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain('must not travel together');
    expect(kinds(planWith('eu-rigid-18', [a, far(misc)]), 'hazmat')).toHaveLength(0);
  });

  it('hazmat: separation distance', () => {
    const flammable = pallet({ hazmat: { unNumber: 'UN1263', hazClass: '3' } });
    const oxidizer = pallet({ hazmat: { unNumber: 'UN2880', hazClass: '5.1' } });
    const a: Item = { key: 'a', spec: flammable, pos: { x: 0, y: 0, z: 0 } };
    expect(kinds(planWith('eu-rigid-18', [a, { key: 'b', spec: oxidizer, pos: { x: 1.7, y: 0, z: 0 } }]), 'hazmat')).toHaveLength(1);
    expect(kinds(planWith('eu-rigid-18', [a, { key: 'b', spec: oxidizer, pos: { x: 2.7, y: 0, z: 0 } }]), 'hazmat')).toHaveLength(0);
  });

  it('hazmat: class 6.1 keeps away from food', () => {
    const toxic = pallet({ hazmat: { unNumber: 'UN2810', hazClass: '6.1' } });
    const food = pallet({ isFood: true });
    const a: Item = { key: 'a', spec: toxic, pos: { x: 0, y: 0, z: 0 } };
    const bad = kinds(planWith('eu-rigid-18', [a, { key: 'b', spec: food, pos: { x: 1.5, y: 0, z: 0 } }]), 'hazmat');
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain('from food b');
    expect(kinds(planWith('eu-rigid-18', [a, { key: 'b', spec: food, pos: { x: 2.5, y: 0, z: 0 } }]), 'hazmat')).toHaveLength(0);
  });

  it('bounds, ceiling and overlap', () => {
    expect(kinds(planWith('eu-rigid-18', [{ key: 'u', spec: pallet(), pos: { x: 6.5, y: 0, z: 0 } }]), 'bounds')).toHaveLength(1);
    const tall = pallet({ dims: { l: 1.2, w: 0.8, h: 2.48 } });
    expect(kinds(planWith('eu-rigid-18', [{ key: 'u', spec: tall, pos: { x: 0, y: 0, z: 0 } }]), 'ceiling')).toHaveLength(1);
    const twin: Item[] = [base, { key: 'b', spec: pallet(), pos: { x: 0.5, y: 0, z: 0 } }];
    const overlap = kinds(planWith('eu-rigid-18', twin), 'overlap');
    expect(overlap).toHaveLength(1);
    expect(overlap[0].unitIds.sort()).toEqual(['b#0', 'bottom#0']);
    // Touching within the 1 cm tolerance is fine.
    expect(kinds(planWith('eu-rigid-18', [base, { key: 'b', spec: pallet(), pos: { x: 1.195, y: 0, z: 0 } }]), 'overlap')).toHaveLength(0);
  });
});

describe('soft constraints on the seed plan', () => {
  it('reports the drive tandem at every stage with the top 3 contributors and a slider fix', () => {
    const plan = createSeedPlan();
    const axle = kinds(plan, 'axle-max');
    expect(axle.length).toBeGreaterThanOrEqual(1);
    expect(axle[0].message).toMatch(/^Drive tandem over limit at departure: [\d,]+ \/ 15,422 kg$/);
    expect(axle.some((v) => v.message.includes('after stop 1'))).toBe(true);
    for (const v of axle) {
      expect(v.unitIds).toHaveLength(3);
      expect(v.hard).toBe(false);
      expect(v.fix?.action.type).toBe('slider');
      expect(v.fix?.label).toMatch(/^Slide trailer tandem \d+ holes forward$/);
    }
    const lifo = kinds(plan, 'lifo');
    expect(lifo.length).toBeGreaterThanOrEqual(1);
    expect(lifo[0].message).toContain('Lithium-ion batteries (stop 2) blocks stop 1');
  });

  it('honours the imperial unit system in messages', () => {
    const plan = createSeedPlan();
    plan.settings.units = 'imperial';
    expect(kinds(plan, 'axle-max')[0].message).toMatch(/ lb$/);
  });

  it('proposes a unit move when no slider position helps', () => {
    const items: Item[] = [{ key: 'heavy', spec: pallet({ weightKg: 6000, dims: { l: 1.2, w: 1.0, h: 1.0 } }), pos: { x: 6, y: 0.7, z: 0 } }];
    const plan = planWith('eu-rigid-18', items);
    const rear = kinds(plan, 'axle-max');
    expect(rear).toHaveLength(1);
    expect(rear[0].unitIds).toEqual(['heavy#0']);
    const fix = rear[0].fix;
    expect(fix?.action.type).toBe('move');
    expect(fix?.label).toMatch(/^Move heavy [\d.]+ m forward$/);
    if (fix?.action.type !== 'move') return;
    const moved = { ...plan, placements: { ...plan.placements, 'heavy#0': { ...plan.placements['heavy#0'], pos: fix.action.pos } } };
    expect(kinds(moved, 'axle-max')).toHaveLength(0);
  });

  it('warns above the forklift capacity', () => {
    const items: Item[] = [{ key: 'heavy', spec: pallet({ weightKg: 2600 }), pos: { x: 2, y: 0.8, z: 0 } }];
    const forklift = kinds(planWith('eu-rigid-18', items), 'forklift');
    expect(forklift).toHaveLength(1);
    expect(forklift[0].severity).toBe('warning');
  });

  it('violation ids are unique', () => {
    const ids = evaluatePlan(createSeedPlan()).violations.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('validateMove', () => {
  const items: Item[] = [
    { key: 'Press die set, crated', spec: makeSpec({ name: 'Press die set, crated', dims: { l: 1.2, w: 1.0, h: 0.9 }, weightKg: 1450 }), pos: { x: 0, y: 0, z: 0 } },
    { key: 'box', spec: pallet(), pos: { x: 3, y: 0, z: 0 } },
    { key: 'top', spec: pallet(), pos: { x: 3, y: 0, z: 1.0 } },
  ];
  const plan = planWith('eu-rigid-18', items);

  it('accepts a free legal spot', () => {
    expect(validateMove(plan, { unitId: 'top#0', vehicleId: 'v1', pos: { x: 5, y: 0, z: 0 }, orient: 0 })).toEqual({ ok: true, reasons: [] });
  });

  it('names the unit it would overlap', () => {
    const r = validateMove(plan, { unitId: 'top#0', vehicleId: 'v1', pos: { x: 0.5, y: 0, z: 0 }, orient: 0 });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('Overlaps Press die set, crated');
  });

  it('rejects moving a unit that carries others', () => {
    const r = validateMove(plan, { unitId: 'box#0', vehicleId: 'v1', pos: { x: 5, y: 0, z: 0 }, orient: 0 });
    expect(r.reasons).toContain('Unstack the units on top first');
  });

  it('checks the effect on its new supporters', () => {
    const r = validateMove(plan, { unitId: 'top#0', vehicleId: 'v1', pos: { x: 0, y: 0, z: 0.9 }, orient: 0 });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toContain('not stackable');
    const floating = validateMove(plan, { unitId: 'top#0', vehicleId: 'v1', pos: { x: 5, y: 0, z: 0.5 }, orient: 0 });
    expect(floating.reasons[0]).toMatch(/^Only 0 % of the base is supported/);
  });
});

describe('performance with 300 units', () => {
  function bigPlan(): Plan {
    const spec = pallet({ name: 'Carton', dims: { l: 0.4, w: 0.3, h: 0.3 }, weightKg: 60, maxLoadOnTopKg: 100 });
    const items: Item[] = [];
    for (let z = 0; z < 3; z++) for (let i = 0; i < 15; i++) for (let j = 0; j < 7 && items.length < 300; j++) {
      items.push({ key: `c${items.length}`, spec, stop: 1 + (i % 3), pos: { x: i * 0.8, y: j * 0.3, z: z * 0.3 } });
    }
    return planWith('container-40hc', items);
  }

  it('checkPlan < 16 ms and validateMove < 2 ms', () => {
    const plan = bigPlan();
    expect(expandUnits(plan)).toHaveLength(300);
    const ev = evaluatePlan(plan);
    const physics: Record<string, VehiclePhysics> = {};
    for (const [id, ve] of Object.entries(ev.byVehicle)) {
      physics[id] = { vehicle: ve.vehicle, points: ve.points, stages: ve.stages, bridge: ve.bridge, floorPeak: ve.floorPeak, lateral: ve.lateral, cogHeight: ve.cogHeight };
    }
    const checkTimes: number[] = [];
    const moveTimes: number[] = [];
    for (let r = 0; r < 7; r++) {
      const fresh = { ...plan };
      const t0 = performance.now();
      checkPlan(fresh, expandUnits(fresh), physics);
      checkTimes.push(performance.now() - t0);
      for (let k = 0; k < 10; k++) {
        const t1 = performance.now();
        validateMove(fresh, { unitId: `c${290 + k}#0`, vehicleId: 'v1', pos: { x: 11, y: 0.2 * k, z: 0 }, orient: 0 });
        moveTimes.push(performance.now() - t1);
      }
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    expect(median(checkTimes)).toBeLessThan(16);
    expect(median(moveTimes)).toBeLessThan(2);
  });
});
