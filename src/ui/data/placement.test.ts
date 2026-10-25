import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyPlan } from '../../data/emptyPlan';
import { BUILT_IN_TEMPLATES, templateById } from '../../data/templates';
import { unitIdOf } from '../../domain/geometry';
import { useStore } from '../../state/store';
import { withMaterialVolume } from '../../domain/materials';
import { bulkCardDefault } from './itemChecks';
import { addCargoToVehicle } from './placement';

const spec = (id: string) => templateById(`tpl-${id}`, [])!.spec;

describe('addCargoToVehicle', () => {
  beforeEach(() => useStore.getState().replacePlan(createEmptyPlan('eu-rigid-18')));
  const ctx = () => {
    const { plan } = useStore.getState();
    return { stopId: plan.stops[0].id, vehicleId: plan.vehicles[0].id };
  };

  it('adds and places 4 apparel pallets in an empty EU box truck as one undo step', () => {
    const { stopId, vehicleId } = ctx();
    const result = addCargoToVehicle(spec('apparel-eur'), 4, stopId, vehicleId, { contents: '480 pcs' });
    expect(result.placed).toHaveLength(4);
    expect(result.unplaced).toEqual([]);
    const { plan } = useStore.getState();
    const line = plan.lines.find((l) => l.id === result.lineId)!;
    expect(line).toMatchObject({ quantity: 4, stopId, contents: '480 pcs' });
    expect(result.placed.every((id) => plan.placements[id]?.vehicleId === vehicleId)).toBe(true);
    useStore.getState().undo();
    expect(useStore.getState().plan.lines.some((l) => l.id === result.lineId)).toBe(false);
  });

  it('adds a bulk water fill to a box truck as an unplaced line', () => {
    const { stopId, vehicleId } = ctx();
    const result = addCargoToVehicle(spec('water-bulk'), 1, stopId, vehicleId);
    expect(result.placed).toEqual([]);
    expect(result.unplaced).toEqual([unitIdOf(result.lineId, 0)]);
    expect(useStore.getState().plan.lines.some((l) => l.id === result.lineId)).toBe(true);
  });

  it('reports leftovers when the truck is full', () => {
    const { stopId, vehicleId } = ctx();
    const result = addCargoToVehicle(spec('apparel-eur'), 60, stopId, vehicleId);
    expect(result.placed.length).toBeGreaterThan(0);
    expect(result.unplaced.length).toBeGreaterThan(0);
    expect(result.placed.length + result.unplaced.length).toBe(60);
  });

  it('uses a valid drop placement for unit #0 and falls back when it is invalid', () => {
    const { stopId, vehicleId } = ctx();
    const drop = { unitId: '', vehicleId, pos: { x: 3, y: 0, z: 0 }, orient: 0 as const };
    const ok = addCargoToVehicle(spec('apparel-eur'), 2, stopId, vehicleId, { first: drop });
    expect(useStore.getState().plan.placements[ok.placed[0]].pos).toEqual({ x: 3, y: 0, z: 0 });
    const outside = { ...drop, pos: { x: 50, y: 0, z: 0 } };
    const fallback = addCargoToVehicle(spec('apparel-eur'), 1, stopId, vehicleId, { first: outside });
    expect(fallback.placed).toHaveLength(1);
    expect(useStore.getState().plan.placements[fallback.placed[0]].pos.x).toBeLessThan(10);
  });

  it('resolves templates from the user library before the built-ins', () => {
    const saved = { ...BUILT_IN_TEMPLATES[0], builtIn: false, spec: { ...BUILT_IN_TEMPLATES[0].spec, name: 'Mine' } };
    expect(templateById(saved.id, [saved])?.spec.name).toBe('Mine');
    expect(templateById('tpl-unknown', [])).toBeUndefined();
  });
});

describe('bulkCardDefault', () => {
  const water = () => spec('water-bulk');

  it('caps a bulk card at the best free compartment of the vehicle (5,000 L water tanker → 4,900 L at 98 %)', () => {
    const plan = createEmptyPlan('id-water-cdd-5k');
    const d = bulkCardDefault(plan, plan.vehicles[0], water());
    expect(d.volumeL).toBeCloseTo(4900, 6);
    expect(d.legal).toMatchObject({ label: 'C1' });
    expect(d.legal!.pctOfCapacity).toBeCloseTo(98, 6);
    expect(d.problem).toBeUndefined();
  });

  it('keeps the template volume when it is already legal, and explains vehicles that cannot take it', () => {
    const tipper = createEmptyPlan('id-dump-tronton');
    const sand = bulkCardDefault(tipper, tipper.vehicles[0], spec('sand-wet-bulk'));
    expect(sand.volumeL).toBe(7800);
    expect(sand.legal).toMatchObject({ label: 'Body', limitedBy: 'Payload' });
    expect(sand.legal!.litres).toBeGreaterThan(7800);
    const box = createEmptyPlan('eu-rigid-18');
    expect(bulkCardDefault(box, box.vehicles[0], water())).toEqual({ volumeL: 7800, problem: 'Needs a tanker' });
    expect(bulkCardDefault(box, box.vehicles[0], spec('sand-wet-bulk')).problem).toBe('Needs a dump truck');
  });

  it('reports a tanker whose compartments are all taken', () => {
    useStore.getState().replacePlan(createEmptyPlan('id-water-cdd-5k'));
    const { plan } = useStore.getState();
    addCargoToVehicle(withMaterialVolume(water(), 4900), 1, plan.stops[0].id, plan.vehicles[0].id);
    const full = useStore.getState().plan;
    expect(bulkCardDefault(full, full.vehicles[0], water()).problem).toBe('No free compartment');
  });
});
