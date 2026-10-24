import { describe, expect, it } from 'vitest';
import { createSeedPlan, makeSpec } from '../data/seed';
import { expandUnits } from '../domain/geometry';
import { createVehicle, VEHICLE_PRESETS } from '../domain/presets';
import { defaultSettings, HAZMAT_CLASSES } from '../domain/settings';
import type { CargoLine, ItemSpec, Placement, Plan, RotationRule, TempClass } from '../domain/types';
import { validateMove } from '../rules';
import { evaluatePlan } from '../state/evaluate';
import { applyOptimiseResult } from '../state/store';
import { findPlacementFor, optimise, proposeVehicles, type OptimiseResult } from '.';
import { mulberry32 } from './random';

function emptyPlan(presetIds: string[], lines: CargoLine[], stopCount = 3): Plan {
  const stops = Array.from({ length: stopCount }, (_, i) => ({ id: `s${i + 1}`, name: `Stop ${i + 1}`, customerId: `c${i + 1}`, sequence: i + 1 }));
  return {
    version: 1,
    id: 'test',
    name: 'Test',
    meta: { date: '2026-01-01', time: '06:00', dock: '', route: '', returnKm: 0, driver: '', notes: '' },
    customers: stops.map((s) => ({ id: s.customerId, name: s.name, color: '#000000' })),
    stops,
    lines,
    vehicles: presetIds.map((id, i) => createVehicle(id, `v${i + 1}`)),
    placements: {},
    settings: defaultSettings(),
  };
}

const line = (id: string, spec: ItemSpec, quantity = 1, stop = 1): CargoLine => ({ id, spec, quantity, stopId: `s${stop}`, priority: 'normal' });
const pallet = (partial: Partial<ItemSpec> = {}): ItemSpec => makeSpec({ name: 'Pallet', dims: { l: 1.2, w: 0.8, h: 1.2 }, weightKg: 300, ...partial });

function run(plan: Plan, opts: { keepExisting?: boolean; seed?: number; timeBudgetMs?: number; maxIterations?: number; vehicleIds?: string[]; unitIds?: string[] } = {}) {
  const vehicleIds = opts.vehicleIds ?? plan.vehicles.map((v) => v.id);
  const result = optimise({
    plan,
    vehicleIds,
    unitIds: opts.unitIds,
    keepExisting: opts.keepExisting ?? false,
    seed: opts.seed ?? 1,
    timeBudgetMs: opts.timeBudgetMs ?? 50,
    maxIterations: opts.maxIterations,
  });
  const applied = applyOptimiseResult(plan, { ...result, vehicleIds });
  return { result, applied, ev: evaluatePlan(applied) };
}

function expectComplete(plan: Plan, result: OptimiseResult): void {
  const unplaced = new Set(result.unplaced.map((u) => u.unitId));
  for (const u of expandUnits(plan)) expect(!!result.placements[u.id] !== unplaced.has(u.id)).toBe(true);
}

describe('seed scenario', () => {
  it('optimise fixes the overloaded drive tandem and the LIFO problem within the budget', () => {
    const plan = createSeedPlan();
    const before = evaluatePlan(plan).violations;
    expect(before.some((v) => v.kind === 'axle-max')).toBe(true);
    expect(before.some((v) => v.kind === 'lifo')).toBe(true);

    const vehicleIds = plan.vehicles.map((v) => v.id);
    const t0 = performance.now();
    const result = optimise({ plan, vehicleIds, keepExisting: false, seed: 42, timeBudgetMs: 3000 });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThanOrEqual(3500);

    const applied = applyOptimiseResult(plan, { ...result, vehicleIds });
    const ev = evaluatePlan(applied);
    expect(ev.violations.filter((v) => v.hard)).toEqual([]);
    for (const st of ev.byVehicle[vehicleIds[0]].stages) {
      for (const a of st.axle.axles) expect(['legal', 'near']).toContain(a.status);
    }
    expect(result.unplaced).toEqual([]);
    expect(Object.keys(result.placements)).toHaveLength(26);
    expect(ev.unplaced).toHaveLength(0);
    expect(ev.violations.filter((v) => v.kind === 'lifo')).toEqual([]);
    expect(result.iterations).toBeGreaterThan(10);
    expect(result.sliders[vehicleIds[0]]).toBeDefined();

    // Multi-temp bulkheads: frozen at the front, then chilled, then ambient, contiguous over the floor.
    const zones = result.zones[vehicleIds[0]];
    expect(zones.map((z) => z.temp)).toEqual(['frozen', 'chilled', 'ambient']);
    expect(zones[0].fromX).toBe(0);
    expect(zones[zones.length - 1].toX).toBeCloseTo(plan.vehicles[0].cargo.l, 6);
    for (let i = 1; i < zones.length; i++) expect(zones[i].fromX).toBe(zones[i - 1].toX);
  }, 10_000);

  it('urgent order: stable re-optimise keeps most placements', () => {
    const seed = createSeedPlan();
    const vehicleIds = seed.vehicles.map((v) => v.id);
    // Iteration caps (with a budget never reached) keep this independent of machine speed.
    const base = run(seed, { maxIterations: 150, timeBudgetMs: 60_000, seed: 42 }).applied;
    const urgent: Plan = {
      ...base,
      lines: [...base.lines, { ...line('line-urgent', pallet({ name: 'Urgent spares', weightKg: 400 }), 2, 2), priority: 'urgent' }],
    };
    const { result, ev } = run(urgent, { keepExisting: true, maxIterations: 200, timeBudgetMs: 60_000, seed: 42, vehicleIds });
    expect(result.unplaced).toEqual([]);
    expect(ev.violations.filter((v) => v.hard)).toEqual([]);
    expect(result.moved).toBeLessThanOrEqual(8);
    expect(result.placements['line-urgent#0']).toBeDefined();
  }, 10_000);

  it('keepExisting returns the current layout untouched when new units fit cleanly', () => {
    const plan = emptyPlan(['eu-curtainsider-136'], [line('a', pallet(), 4, 1)]);
    const first = run(plan, { timeBudgetMs: 30 });
    const more: Plan = { ...first.applied, lines: [...first.applied.lines, line('b', pallet(), 1, 1)] };
    const { result } = run(more, { keepExisting: true, timeBudgetMs: 200 });
    expect(result.moved).toBe(0);
    // A clean first try returns immediately; otherwise the full search still pays for every move.
    for (let i = 0; i < 4; i++) expect(result.placements[`a#${i}`]).toEqual(first.applied.placements[`a#${i}`]);
    expect(result.placements['b#0']).toBeDefined();
  });

  it('an iteration cap makes the result reproducible for the same plan and seed', () => {
    const opts = { maxIterations: 80, timeBudgetMs: 60_000, seed: 7 };
    const a = run(createSeedPlan(), opts).result;
    const b = run(createSeedPlan(), opts).result;
    expect(a.iterations).toBe(80);
    expect(b.placements).toEqual(a.placements);
    expect(b.sliders).toEqual(a.sliders);
    expect(b.zones).toEqual(a.zones);
  });
});

describe('optimise', () => {
  it('returns pinned units unchanged and packs around them', () => {
    const plan = emptyPlan(['eu-rigid-18'], [line('pin', pallet()), line('free', pallet(), 6)]);
    const pinned: Placement = { unitId: 'pin#0', vehicleId: 'v1', pos: { x: 0.5, y: 0.5, z: 0 }, orient: 0, pinned: true };
    plan.placements['pin#0'] = pinned;
    const { result, ev } = run(plan);
    expect(result.placements['pin#0']).toBe(pinned);
    expect(result.unplaced).toEqual([]);
    expect(ev.violations.filter((v) => v.hard)).toEqual([]);
  });

  it('leaves units placed in other vehicles alone', () => {
    const plan = emptyPlan(['eu-rigid-18', 'eu-rigid-18'], [line('a', pallet(), 2)]);
    plan.placements['a#0'] = { unitId: 'a#0', vehicleId: 'v2', pos: { x: 0, y: 0, z: 0 }, orient: 0 };
    const { result } = run(plan, { vehicleIds: ['v1'] });
    expect(result.placements['a#0']).toBeUndefined();
    expect(result.placements['a#1'].vehicleId).toBe('v1');
  });

  it('explains every unplaced unit', () => {
    const reason = (presetId: string, specs: ItemSpec[]) => {
      const plan = emptyPlan([presetId], specs.map((s, i) => line(`l${i}`, s)));
      const { result } = run(plan, { timeBudgetMs: 20 });
      expectComplete(plan, result);
      return result.unplaced.map((u) => u.reason);
    };
    expect(reason('eu-rigid-18', [pallet({ temp: 'chilled' })])).toEqual(['Needs temperature control']);
    expect(reason('eu-van-35', [pallet({ dims: { l: 5, w: 1, h: 1 }, rotation: 'none' })])).toEqual(['Larger than the cargo space']);
    expect(reason('eu-rigid-18', [pallet({ dims: { l: 1, w: 1, h: 2.42 } })])).toEqual(['Does not fit through the door']);
    expect(reason('eu-van-35', [pallet({ weightKg: 800 }), pallet({ weightKg: 800 })])).toEqual(['Too heavy for the remaining payload']);
    const never = reason('eu-rigid-18', [pallet({ name: 'Chlorine gas', hazmat: { unNumber: 'UN1017', hazClass: '2.3' } }), pallet({ name: 'Paint', hazmat: { unNumber: 'UN1263', hazClass: '3' } })]);
    expect(never).toHaveLength(1);
    expect(never[0]).toMatch(/^Hazmat conflict with (Chlorine gas|Paint)$/);
    expect(reason('eu-van-35', Array.from({ length: 8 }, () => pallet({ weightKg: 50, dims: { l: 1.2, w: 0.8, h: 1.5 } })))).toEqual(['No space left', 'No space left']);
    const frozen = Array.from({ length: 40 }, () => pallet({ temp: 'frozen', weightKg: 100, dims: { l: 1.2, w: 1.0, h: 2.0 } }));
    expect(reason('us-reefer-53', frozen)).toContain('No frozen zone space left');
  });

  it('separates hazmat classes that must be kept apart', () => {
    const plan = emptyPlan(['eu-rigid-18'], [
      line('paint', pallet({ hazmat: { unNumber: 'UN1263', hazClass: '3' } }), 2),
      line('oxidizer', pallet({ hazmat: { unNumber: 'UN2880', hazClass: '5.1' } }), 2),
    ]);
    const { result, ev } = run(plan);
    expect(result.unplaced).toEqual([]);
    expect(ev.violations.filter((v) => v.hard)).toEqual([]);
  });

  it('stacks stackable units and never stacks on fragile ones', () => {
    const plan = emptyPlan(['eu-van-35'], [
      line('base', pallet({ name: 'Base', dims: { l: 1.2, w: 0.8, h: 0.8 }, weightKg: 100, stackable: true, maxLoadOnTopKg: 500, maxStackLayers: 2 }), 4),
      line('glass', pallet({ name: 'Glass', dims: { l: 1.2, w: 0.8, h: 0.8 }, weightKg: 100, fragile: true }), 2),
    ]);
    const { result, ev } = run(plan, { timeBudgetMs: 100 });
    expect(result.unplaced).toEqual([]);
    expect(ev.violations.filter((v) => v.hard)).toEqual([]);
    expect(Object.values(result.placements).some((p) => p.pos.z > 0.5)).toBe(true);
  });

  it('reports progress and finishes at 1', () => {
    const plan = createSeedPlan();
    const seen: number[] = [];
    optimise({ plan, vehicleIds: ['veh-1'], keepExisting: false, seed: 3, timeBudgetMs: 300 }, (f) => seen.push(f));
    expect(seen.length).toBeGreaterThan(2);
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });
});

describe('property: random loads never break a hard rule', () => {
  const temps: TempClass[] = ['ambient', 'ambient', 'ambient', 'chilled', 'frozen'];
  const rotations: RotationRule[] = ['none', 'yaw', 'yaw', 'any'];

  function randomPlan(seed: number): Plan {
    const rnd = mulberry32(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    const range = (a: number, b: number) => Math.round((a + rnd() * (b - a)) * 100) / 100;
    const lines: CargoLine[] = [];
    const lineCount = 1 + Math.floor(rnd() * 6);
    for (let i = 0; i < lineCount; i++) {
      const stackable = rnd() < 0.5;
      const spec = makeSpec({
        name: `Item ${i + 1}`,
        dims: { l: range(0.3, 1.8), w: range(0.3, 1.3), h: range(0.3, 1.9) },
        weightKg: range(20, 1400),
        cogOffset: { x: range(-0.1, 0.1), y: range(-0.05, 0.05), z: range(-0.1, 0) },
        stackable,
        maxLoadOnTopKg: stackable ? range(100, 1500) : 0,
        maxStackLayers: stackable ? 1 + Math.floor(rnd() * 3) : 1,
        fragile: rnd() < 0.1,
        keepUpright: rnd() < 0.5,
        rotation: pick(rotations),
        temp: pick(temps),
        isFood: rnd() < 0.15,
        hazmat: rnd() < 0.2 ? { unNumber: 'UN0000', hazClass: pick(HAZMAT_CLASSES) } : undefined,
      });
      lines.push({ ...line(`l${i}`, spec, 1 + Math.floor(rnd() * 4), 1 + Math.floor(rnd() * 3)), priority: rnd() < 0.1 ? 'urgent' : 'normal' });
    }
    return emptyPlan([pick(VEHICLE_PRESETS).id], lines);
  }

  it('200 seeded random item sets on random presets', () => {
    let placedTotal = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const plan = randomPlan(seed);
      const { result, ev } = run(plan, { seed, timeBudgetMs: 30 });
      const hard = ev.violations.filter((v) => v.hard);
      if (hard.length) throw new Error(`seed ${seed}: ${hard.map((v) => v.message).join('; ')}`);
      expectComplete(plan, result);
      placedTotal += Object.keys(result.placements).length;
    }
    expect(placedTotal).toBeGreaterThan(500);
  }, 60_000);
});

describe('findPlacementFor', () => {
  it('finds a legal spot without moving other units', () => {
    // The seed layout is fixed and leaves a pallet-sized gap by the rear doors.
    const seed = createSeedPlan();
    const plan: Plan = { ...seed, lines: [...seed.lines, { ...line('extra', pallet({ name: 'Extra' })), stopId: 'stop-1' }] };
    const p = findPlacementFor(plan, 'extra#0', 'veh-1');
    expect(p).not.toBeNull();
    expect(validateMove(plan, p!).ok).toBe(true);
  });

  it('returns null when nothing fits', () => {
    const plan = emptyPlan(['eu-van-35'], [line('huge', pallet({ dims: { l: 5, w: 3, h: 3 } }))]);
    expect(findPlacementFor(plan, 'huge#0', 'v1')).toBeNull();
  });
});

describe('proposeVehicles', () => {
  it('needs a reefer for temperature-controlled goods', () => {
    expect(proposeVehicles(createSeedPlan())).toEqual(['us-reefer-53']);
  });

  it('picks the fewest, smallest vehicles for dry goods (no vehicles yet: every region is a candidate)', () => {
    const light = emptyPlan([], [line('a', pallet({ weightKg: 150, dims: { l: 1.2, w: 0.8, h: 1.0 } }), 3)]);
    // 3 EUR pallets, 450 kg: the 1 t Indonesian pick-up (2.45 × 1.6 m bed, 2 × 2 pallet spots) is the smallest preset.
    expect(proposeVehicles(light)).toEqual(['id-pickup']);
    const heavy = emptyPlan([], [line('a', pallet({ weightKg: 900 }), 24)]);
    const fleet = proposeVehicles(heavy);
    expect(fleet.length).toBe(1);
  });

  it('keeps to the regions of the vehicles already in the plan, plus ISO containers', () => {
    const us = emptyPlan(['us-dry-van-53'], [line('a', pallet({ weightKg: 150, dims: { l: 1.2, w: 0.8, h: 1.0 } }), 3)]);
    const fleet = proposeVehicles(us);
    expect(fleet.length).toBeGreaterThan(0);
    const regionOf = new Map(VEHICLE_PRESETS.map((p) => [p.id, p.region]));
    for (const id of fleet) expect(['US', 'INTL']).toContain(regionOf.get(id));
    // A custom vehicle states no preference: every region again.
    const custom = emptyPlan(['eu-van-35'], us.lines);
    custom.vehicles[0].region = 'custom';
    expect(proposeVehicles(custom)).toEqual(['id-pickup']);
  });
});
