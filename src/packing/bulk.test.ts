import { describe, expect, it } from 'vitest';
import { createTankerSeedPlan, createTipperSeedPlan, makeBulkSpec, makeSpec } from '../data/seed';
import { createVehicle } from '../domain/presets';
import { defaultSettings } from '../domain/settings';
import type { CargoLine, Plan } from '../domain/types';
import { validateMove } from '../rules';
import { evaluatePlan } from '../state/evaluate';
import { applyOptimiseResult } from '../state/store';
import { findPlacementFor, optimise, proposeVehicles } from '.';

function planWith(presetIds: string[], lines: CargoLine[]): Plan {
  const stops = [1, 2, 3].map((n) => ({ id: `s${n}`, name: `Stop ${n}`, customerId: `c${n}`, sequence: n }));
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

const fill = (id: string, liquidId: string, litres: number, stop = 1): CargoLine => ({ id, spec: makeBulkSpec(liquidId, litres), quantity: 1, stopId: `s${stop}`, priority: 'normal' });

function run(plan: Plan, opts: { keepExisting?: boolean; maxIterations?: number } = {}) {
  const vehicleIds = plan.vehicles.map((v) => v.id);
  const result = optimise({ plan, vehicleIds, keepExisting: opts.keepExisting ?? false, seed: 42, timeBudgetMs: 3000, maxIterations: opts.maxIterations });
  const applied = applyOptimiseResult(plan, { ...result, vehicleIds });
  return { result, ev: evaluatePlan(applied) };
}

describe('tanker optimisation', () => {
  it('fixes the tanker seed: all fills placed, legal at every stage, deterministic', () => {
    const plan = createTankerSeedPlan();
    const t0 = performance.now();
    const { result, ev } = run(plan, { maxIterations: 5000 });
    expect(performance.now() - t0).toBeLessThanOrEqual(3000);
    expect(result.unplaced).toEqual([]);
    expect(Object.values(result.placements).map((p) => p.compartmentId).sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(ev.violations.filter((v) => v.hard)).toEqual([]);
    for (const st of ev.byVehicle['veh-1'].stages) for (const a of st.axle.axles) expect(['legal', 'near']).toContain(a.status);
    expect(result.moved).toBeGreaterThan(0);
    const again = run(createTankerSeedPlan(), { maxIterations: 5000 }).result;
    expect(again.placements).toEqual(result.placements);
    expect(again.iterations).toBe(result.iterations);
  });

  it('stable mode keeps a clean assignment and only adds the new fill', () => {
    const plan = planWith(['tanker-rigid-16k'], [fill('a', 'diesel', 3800), fill('b', 'diesel', 3800, 2)]);
    const first = run(plan).result;
    const applied = applyOptimiseResult(plan, { ...first, vehicleIds: ['v1'] });
    expect(evaluatePlan(applied).violations).toEqual([]);
    const more: Plan = { ...applied, lines: [...applied.lines, fill('c', 'diesel', 3800, 3)] };
    const { result, ev } = run(more, { keepExisting: true });
    expect(result.moved).toBe(0);
    expect(result.placements['a#0']).toEqual(applied.placements['a#0']);
    expect(result.placements['c#0'].compartmentId).toBeDefined();
    expect(ev.violations.filter((v) => v.hard)).toEqual([]);
  });

  it('keeps pinned fills where they are', () => {
    const plan = createTankerSeedPlan();
    plan.placements['line-diesel-3#0'] = { ...plan.placements['line-diesel-3#0'], pinned: true };
    const { result } = run(plan);
    expect(result.placements['line-diesel-3#0']).toBe(plan.placements['line-diesel-3#0']);
    expect(Object.values(result.placements).filter((p) => p.compartmentId === 'c5')).toHaveLength(1);
  });

  it('distributes fills over several tankers and keeps packaged units off them', () => {
    const pallet = makeSpec({ name: 'Pallet', dims: { l: 1.2, w: 0.8, h: 1 }, weightKg: 300 });
    const plan = planWith(
      ['tanker-rigid-16k', 'tanker-rigid-16k', 'eu-rigid-18'],
      [...[1, 2, 3, 4, 5, 6].map((i) => fill(`d${i}`, 'diesel', 3800, 1 + (i % 3))), { id: 'p', spec: pallet, quantity: 2, stopId: 's1', priority: 'normal' }],
    );
    const { result, ev } = run(plan);
    expect(result.unplaced).toEqual([]);
    expect(ev.violations.filter((v) => v.hard)).toEqual([]);
    const tankers = new Set(Object.values(result.placements).filter((p) => p.compartmentId).map((p) => p.vehicleId));
    expect(tankers).toEqual(new Set(['v1', 'v2']));
    expect(result.placements['p#0'].vehicleId).toBe('v3');
    expect(result.placements['p#1'].vehicleId).toBe('v3');
  });

  it('explains fills that cannot be carried', () => {
    const reasons = (presetIds: string[], lines: CargoLine[]) => run(planWith(presetIds, lines)).result.unplaced.map((u) => u.reason);
    expect(reasons(['eu-rigid-18'], [fill('d', 'diesel', 3000)])).toEqual(['Needs a tanker']);
    expect(reasons(['tanker-semi-32k'], [fill('m', 'drinking-water', 3000)])).toEqual(['Needs a food-grade tank']);
    expect(reasons(['tanker-water-8k'], [fill('m', 'milk', 3000)])).toEqual(['Needs an insulated tank']);
    expect(reasons(['tanker-semi-32k'], [fill('l', 'lpg', 3000)])).toEqual(['Needs a pressurised tank']);
    expect(reasons(['tanker-semi-32k'], [fill('d', 'diesel', 9000)])).toEqual(['No free compartment large enough']);
    const toxic: CargoLine = { ...fill('t', 'diesel', 3000), spec: makeBulkSpec('diesel', 3000, { name: 'Toxic gas', hazmat: { unNumber: 'UN0000', hazClass: '2.3' } }) };
    const hazmat = reasons(['tanker-semi-32k'], [fill('g', 'gasoline', 5000), toxic]);
    expect(hazmat).toHaveLength(1);
    expect(hazmat[0]).toMatch(/^Hazmat conflict with (Gasoline \(bensin\)|Toxic gas)$/);
    const pallet = { id: 'p', spec: makeSpec({ name: 'Pallet', dims: { l: 1.2, w: 0.8, h: 1 }, weightKg: 300 }), quantity: 1, stopId: 's1', priority: 'normal' as const };
    expect(reasons(['tanker-semi-32k'], [pallet])).toEqual(['A tanker only carries bulk liquid']);
  });
});

describe('findPlacementFor bulk', () => {
  it('returns the best free compartment that validateMove accepts', () => {
    const plan = createTankerSeedPlan();
    delete plan.placements['line-diesel-3#0'];
    const p = findPlacementFor(plan, 'line-diesel-3#0', 'veh-1');
    expect(p).toEqual({ unitId: 'line-diesel-3#0', vehicleId: 'veh-1', compartmentId: 'c5', pos: { x: plan.vehicles[0].bulk!.compartments[4].fromX, y: 0, z: 0 }, orient: 0 });
    expect(validateMove(plan, p!).ok).toBe(true);
  });

  it('prefers a compartment without surge', () => {
    const plan = planWith(['tanker-semi-32k'], [fill('d', 'diesel', 5000)]);
    expect(findPlacementFor(plan, 'd#0', 'v1')?.compartmentId).not.toBe('c1');
  });

  it('returns null when no compartment fits or the vehicle is not a tanker', () => {
    expect(findPlacementFor(planWith(['tanker-semi-32k'], [fill('d', 'diesel', 9000)]), 'd#0', 'v1')).toBeNull();
    expect(findPlacementFor(planWith(['eu-rigid-18'], [fill('d', 'diesel', 3000)]), 'd#0', 'v1')).toBeNull();
  });
});

describe('proposeVehicles for bulk liquid', () => {
  it('fuel goes to a fuel tanker', () => {
    expect(proposeVehicles(createTankerSeedPlan())).toEqual(['tanker-semi-32k']);
    expect(proposeVehicles(planWith([], [fill('d', 'diesel', 3500)]))).toEqual(['tanker-rigid-16k']);
  });

  it('food to a food-grade tanker, chilled food to an insulated one, LPG to a pressure tanker', () => {
    expect(proposeVehicles(planWith([], [fill('w', 'drinking-water', 7000)]))).toEqual(['tanker-water-8k']);
    expect(proposeVehicles(planWith([], [fill('m', 'milk', 7500), fill('j', 'fruit-juice', 7000)]))).toEqual(['tanker-food-24k']);
    expect(proposeVehicles(planWith([], [fill('l', 'lpg', 30_000)]))).toEqual(['tanker-lpg-44k']);
  });

  it('packaged units never get tankers', () => {
    const pallet = { id: 'p', spec: makeSpec({ name: 'Pallet', dims: { l: 1.2, w: 0.8, h: 1 }, weightKg: 200 }), quantity: 2, stopId: 's1', priority: 'normal' as const };
    const fleet = proposeVehicles(planWith([], [pallet, fill('d', 'diesel', 3500)]));
    expect(fleet).toHaveLength(2);
    expect(fleet[1]).toBe('tanker-rigid-16k');
    expect(fleet[0].startsWith('tanker')).toBe(false);
  });
});

describe('dry bulk in dump trucks', () => {
  it('puts a solid fill into a dump body', () => {
    const { result, ev } = run(planWith(['id-dump-tronton'], [fill('s', 'sand-dry', 8000)]));
    expect(result.unplaced).toEqual([]);
    expect(result.placements['s#0']).toMatchObject({ vehicleId: 'v1', compartmentId: 'body' });
    expect(ev.violations.filter((v) => v.hard)).toEqual([]);
  });

  it('needs a dump truck, and a body large enough', () => {
    const reasons = (presetIds: string[], lines: CargoLine[]) => run(planWith(presetIds, lines)).result.unplaced.map((u) => u.reason);
    expect(reasons(['tanker-semi-32k'], [fill('s', 'sand-wet', 5000)])).toEqual(['Needs a dump truck']);
    expect(reasons(['eu-rigid-18'], [fill('s', 'sand-wet', 5000)])).toEqual(['Needs a dump truck']);
    expect(reasons(['id-dump-tronton'], [fill('s', 'sand-dry', 20_000)])).toEqual(['No dump body large enough']);
    expect(reasons(['id-dump-tronton'], [fill('d', 'diesel', 5000)])).toEqual(['Needs a tanker']);
  });

  it('sends liquids to tankers and solids to dump trucks', () => {
    const { result } = run(planWith(['id-dump-cdd', 'tanker-rigid-16k'], [fill('s', 'gravel', 2500), fill('d', 'diesel', 3800)]));
    expect(result.unplaced).toEqual([]);
    expect(result.placements['s#0'].vehicleId).toBe('v1');
    expect(result.placements['d#0'].vehicleId).toBe('v2');
  });

  it('places both fills of the tipper seed (the overload stays a soft violation)', () => {
    const plan = createTipperSeedPlan();
    const { result, ev } = run(plan);
    expect(result.unplaced).toEqual([]);
    expect(ev.violations.filter((v) => v.hard)).toEqual([]);
  });

  it('findPlacementFor returns the dump body', () => {
    const plan = planWith(['id-dump-tronton'], [fill('s', 'gravel', 6000)]);
    expect(findPlacementFor(plan, 's#0', 'v1')).toEqual({ unitId: 's#0', vehicleId: 'v1', compartmentId: 'body', pos: { x: 0, y: 0, z: 0 }, orient: 0 });
    expect(findPlacementFor(planWith(['id-dump-tronton'], [fill('d', 'diesel', 3000)]), 'd#0', 'v1')).toBeNull();
  });

  it('proposeVehicles: the smallest dump truck that carries the fill legally, else the largest', () => {
    // 2.5 m³ gravel is legal on the CDD dump truck (seed veh-2).
    expect(proposeVehicles(planWith([], [fill('g', 'gravel', 2500)]))).toEqual(['id-dump-cdd']);
    // 10 m³ wet sand = 19 t: the CDD body holds 4.6 m³ and the tronton only 7.9 m³ legally (payload), so the largest, the tronton.
    expect(proposeVehicles(planWith([], [fill('s', 'sand-wet', 10_000)]))).toEqual(['id-dump-tronton']);
  });
});
