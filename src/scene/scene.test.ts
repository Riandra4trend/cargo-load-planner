import { Box3, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createSeedPlan, makeSpec } from '../data/seed';
import { BUILT_IN_TEMPLATES } from '../data/templates';
import { allowedOrientations, ORIENTATION_AXES, orientedSize, placementBox } from '../domain/geometry';
import { createVehicle } from '../domain/presets';
import type { ItemSpec, Orientation, Plan } from '../domain/types';
import { threeToCargo, toThree, vecToThree } from './coords';
import { dragCandidate, dragContext } from './dragMath';
import { goodsArchetype } from './goods/archetype';
import { MAX_PARTS } from './goods/builder';
import { buildGoodsModel, disposeGoodsModel, liquidFraction } from './goods/model';
import { goodsInstanceMatrix, orientationRotation } from './goods/orientation';
import { axleLoadText } from './sceneFormat';
import { dockLayout } from './staging';
import { chordWidth, compartmentAtX, liquidLevel, tankBarrel } from './tankMath';
import { unitParts } from './unitParts';
import { heapShape, heapVolume, MAX_TIP, tipPoint, tipTimeline } from './tipperMath';
import { cabOverClass, vehicleLayout } from './vehicleLayout';

const MM = 0.001;

function expectBoxWithin(inner: Box3, outer: Box3, tol = MM) {
  expect(inner.min.x).toBeGreaterThanOrEqual(outer.min.x - tol);
  expect(inner.min.y).toBeGreaterThanOrEqual(outer.min.y - tol);
  expect(inner.min.z).toBeGreaterThanOrEqual(outer.min.z - tol);
  expect(inner.max.x).toBeLessThanOrEqual(outer.max.x + tol);
  expect(inner.max.y).toBeLessThanOrEqual(outer.max.y + tol);
  expect(inner.max.z).toBeLessThanOrEqual(outer.max.z + tol);
}

/** Placement box of a unit in three.js coordinates. */
function threeBox(spec: ItemSpec, orient: Orientation, pos: { x: number; y: number; z: number }): Box3 {
  const b = placementBox({ pos, orient }, spec);
  return new Box3().setFromPoints([vecToThree(b.min), vecToThree(b.max)]);
}

describe('goods generator', () => {
  const specs: ItemSpec[] = [...BUILT_IN_TEMPLATES.map((t) => t.spec), ...createSeedPlan().lines.map((l) => l.spec)];

  it.each(specs.map((s) => [s.name, s] as const))('%s fits its L×W×H box in every allowed orientation', (_name, spec) => {
    const model = buildGoodsModel(spec);
    expect(model.parts).toBeLessThanOrEqual(MAX_PARTS);
    const local = new Box3();
    for (const g of [model.solid, model.tags, model.film]) {
      if (!g) continue;
      g.computeBoundingBox();
      local.union(g.boundingBox!);
    }
    const { l, w, h } = spec.dims;
    expectBoxWithin(local, new Box3(new Vector3(0, 0, -w), new Vector3(l, h, 0)));
    const pos = { x: 2.5, y: 0.4, z: 0.3 };
    for (const orient of allowedOrientations(spec)) {
      const placed = local.clone().applyMatrix4(goodsInstanceMatrix(orient, spec.dims, pos, new Matrix4()));
      expectBoxWithin(placed, threeBox(spec, orient, pos));
    }
    disposeGoodsModel(model);
  });

  it('picks archetypes from packaging, shape and keywords', () => {
    const byName = new Map(specs.map((s) => [s.name, s]));
    const pick = (name: string) => goodsArchetype(byName.get(name)!);
    expect(pick('Apparel cartons')).toBe('pallet-cartons');
    expect(pick('Frozen fish')).toBe('frozen-cartons');
    expect(pick('Chilled dairy')).toBe('dairy-crates');
    expect(pick('Fresh produce')).toBe('produce-crates');
    expect(pick('Beverages, half pallet')).toBe('beverages');
    expect(pick('Industrial paint')).toBe('pails');
    expect(pick('Pool chlorine (calcium hypochlorite)')).toBe('pails');
    expect(pick('Lithium-ion batteries')).toBe('batteries');
    expect(pick('Flat-screen TVs 65"')).toBe('tv-boxes');
    expect(pick('Press die set, crated')).toBe('wooden-crate');
    expect(pick('Gearbox housing, crated')).toBe('wooden-crate');
    expect(pick('Glass display panels, crated')).toBe('glass-crate');
    expect(pick('CNC spindle unit on skid')).toBe('machine');
    expect(pick('Steel profiles 4 m')).toBe('steel-bundle');
    expect(pick('Lubricating oil drum 200 L')).toBe('drum');
    expect(pick('Paper roll')).toBe('paper-roll');
    expect(pick('Cable reel')).toBe('cable-reel');
    expect(pick('Drinking water IBC 1,000 L')).toBe('ibc');
    expect(pick('Gasoline jerrycan 20 L')).toBe('jerrycan');
    expect(pick('Diesel drum 200 L')).toBe('drum');
    expect(pick('Bricks on industrial pallet')).toBe('bricks');
    expect(pick('Flat-pack furniture cartons')).toBe('furniture');
    expect(goodsArchetype(makeSpec({ name: 'Spare parts', packaging: 'carton', dims: { l: 0.6, w: 0.4, h: 0.4 }, weightKg: 12 }))).toBe('carton');
    expect(goodsArchetype(makeSpec({ name: 'Thing', dims: { l: 1, w: 1, h: 1 }, weightKg: 100 }))).toBe('custom');
  });
});

describe('goods orientation matrices', () => {
  const dims = { l: 1.2, w: 0.8, h: 0.5 };
  it.each(ORIENTATION_AXES.map((_, i) => i as Orientation))('orientation %i is a proper rotation filling the placement box', (orient) => {
    expect(orientationRotation(orient).determinant()).toBeCloseTo(1, 9);
    const pos = { x: 1, y: 2, z: 0.25 };
    const m = goodsInstanceMatrix(orient, dims, pos, new Matrix4());
    expect(m.determinant()).toBeCloseTo(1, 9);
    const local = new Box3(new Vector3(0, 0, -dims.w), new Vector3(dims.l, dims.h, 0));
    const placed = local.clone().applyMatrix4(m);
    const s = orientedSize(dims, orient);
    const expected = new Box3().setFromPoints([vecToThree(pos), vecToThree({ x: pos.x + s.x, y: pos.y + s.y, z: pos.z + s.z })]);
    expect(placed.min.distanceTo(expected.min)).toBeLessThan(1e-9);
    expect(placed.max.distanceTo(expected.max)).toBeLessThan(1e-9);
  });
});

describe('coords', () => {
  it('maps cargo x/y/z to three X / Y-up / -Z and back', () => {
    expect(toThree(1, 2, 3)).toEqual([1, 3, -2]);
    const v = vecToThree({ x: 4, y: 0.5, z: 1.2 }, new Vector3());
    expect(v.toArray()).toEqual([4, 1.2, -0.5]);
    expect(threeToCargo(v)).toEqual({ x: 4, y: 0.5, z: 1.2 });
  });
});

function emptyPlan(): Plan {
  const plan = createSeedPlan();
  return { ...plan, placements: {} };
}

describe('dragCandidate', () => {
  const plan = createSeedPlan();
  const v = plan.vehicles[0];
  const size = { x: 1.2, y: 0.8, z: 1.0 };

  it('snaps to the grid and clamps into the cargo space', () => {
    const ctx = dragContext(emptyPlan(), v.id, 'x#0')!;
    const pos = dragCandidate(ctx, { x: 5.023 + 0.6, y: 0.912 + 0.4 }, size);
    expect(pos.x).toBeCloseTo(5.0, 6);
    expect(pos.y).toBeCloseTo(0.9, 6);
    expect(pos.z).toBe(0);
    const clamped = dragCandidate(ctx, { x: 100, y: -5 }, size);
    expect(clamped.x).toBeCloseTo(v.cargo.l - size.x, 6);
    expect(clamped.y).toBe(0);
  });

  it('snaps to neighbour edges within 8 cm', () => {
    const base = emptyPlan();
    const spec = makeSpec({ name: 'Crate', dims: { l: 1.2, w: 0.8, h: 1 }, weightKg: 100, stackable: true, maxLoadOnTopKg: 1000, maxStackLayers: 3 });
    const p: Plan = { ...base, lines: [{ id: 'L', spec, quantity: 2, stopId: base.stops[0].id, priority: 'normal' }], placements: { 'L#0': { unitId: 'L#0', vehicleId: v.id, pos: { x: 2, y: 0, z: 0 }, orient: 0 } } };
    const ctx = dragContext(p, v.id, 'L#1')!;
    // Raw min x = 3.26 lies 6 cm behind the neighbour's rear face (3.2): snaps flush against it.
    const pos = dragCandidate(ctx, { x: 3.26 + 0.6, y: 0.4 }, size);
    expect(pos.x).toBeCloseTo(3.2, 6);
  });

  it('stacks onto the highest unit under the footprint', () => {
    const base = emptyPlan();
    const spec = makeSpec({ name: 'Crate', dims: { l: 1.2, w: 0.8, h: 1 }, weightKg: 100, stackable: true, maxLoadOnTopKg: 1000, maxStackLayers: 3 });
    const p: Plan = { ...base, lines: [{ id: 'L', spec, quantity: 2, stopId: base.stops[0].id, priority: 'normal' }], placements: { 'L#0': { unitId: 'L#0', vehicleId: v.id, pos: { x: 2, y: 0, z: 0 }, orient: 0 } } };
    const ctx = dragContext(p, v.id, 'L#1')!;
    const pos = dragCandidate(ctx, { x: 2.6, y: 0.4 }, size);
    expect(pos).toEqual({ x: 2, y: 0, z: 1 });
  });
});

describe('unitParts', () => {
  it('splits palletised units into a pallet base and inset goods', () => {
    const spec = makeSpec({ name: 'Pallet', dims: { l: 1.2, w: 0.8, h: 1.6 }, weightKg: 300, palletHeight: 0.144 });
    const parts = unitParts(spec, 0, placementBox({ pos: { x: 0, y: 0, z: 0 }, orient: 0 }, spec));
    expect(parts.map((p) => p.kind)).toEqual(['pallet', 'box']);
    expect(parts[0].box.max.z).toBeCloseTo(0.144);
    expect(parts[1].box.min.z).toBeCloseTo(0.144);
    expect(parts[1].box.min.x).toBeGreaterThan(0);
  });

  it('runs lying cylinders along the item length', () => {
    const spec = makeSpec({ name: 'Roll', shape: 'cylinder-lying', dims: { l: 2, w: 0.6, h: 0.6 }, weightKg: 300, rotation: 'any', keepUpright: false });
    expect(unitParts(spec, 0, placementBox({ pos: { x: 0, y: 0, z: 0 }, orient: 0 }, spec))[0].axis).toBe(0);
    expect(unitParts(spec, 1, placementBox({ pos: { x: 0, y: 0, z: 0 }, orient: 1 }, spec))[0].axis).toBe(1);
  });
});

describe('vehicleLayout', () => {
  it('places semi-trailer tractor axles through the coupling', () => {
    const v = createVehicle('us-reefer-53');
    const layout = vehicleLayout(v);
    if (v.statics.type !== 'artic') throw new Error('expected artic');
    const s = v.statics;
    expect(layout.groupX[0]).toBeCloseTo(s.kingpinX - s.fifthWheelX);
    expect(layout.groupX[1]).toBeCloseTo(s.kingpinX - (s.fifthWheelX - s.drive.x));
    expect(layout.groupX[2]).toBeCloseTo(s.trailerAxle.x);
    const trailerAxles = layout.axles.filter((a) => a.groupIndex === 2).map((a) => a.x);
    expect(trailerAxles[0]).toBeCloseTo(s.trailerAxle.x - s.trailerAxle.spread / 2);
    expect(trailerAxles[1]).toBeCloseTo(s.trailerAxle.x + s.trailerAxle.spread / 2);
    expect(layout.cab.toX).toBeLessThan(0);
  });
});

describe('dockLayout', () => {
  it('gives every unit a slot in its stop lane behind the dock face, lanes ordered by stop', () => {
    const plan = createSeedPlan();
    const v = plan.vehicles[0];
    const units = Object.values(plan.placements).map((p) => {
      const line = plan.lines.find((l) => p.unitId.startsWith(`${l.id}#`))!;
      const stop = plan.stops.find((s) => s.id === line.stopId)!;
      const b = placementBox(p, line.spec);
      return { id: p.unitId, stopId: stop.id, stopSeq: stop.sequence, size: { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z } };
    });
    const dock = dockLayout(v, units);
    expect(dock.slots.size).toBe(units.length);
    expect(dock.lanes.map((l) => l.stopSeq)).toEqual([1, 2, 3, 4, 5]);
    for (const slot of dock.slots.values()) expect(slot.min.x).toBeGreaterThan(dock.wallX);
    for (let i = 1; i < dock.lanes.length; i++) expect(dock.lanes[i].minY).toBeGreaterThan(dock.lanes[i - 1].maxY);
  });
});

describe('axleLoadText', () => {
  it('formats load / limit in the plan unit system', () => {
    expect(axleLoadText(15_400, 15_422, 'metric')).toBe('15.4 / 15.4 t');
    expect(axleLoadText(15_400, 15_422.2, 'imperial')).toBe('33,951 / 34,000 lb');
  });
});

describe('tank liquid level', () => {
  it('maps fill fractions of an elliptical section to levels', () => {
    expect(liquidLevel(0, 1.8)).toBe(0);
    expect(liquidLevel(1, 1.8)).toBe(1.8);
    expect(liquidLevel(0.5, 1.8)).toBeCloseTo(0.9, 9);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const level = liquidLevel(i / 100, 2.4);
      expect(level).toBeGreaterThan(prev);
      prev = level;
    }
    // A quarter of the area sits well below a quarter of the height (narrow bottom).
    expect(liquidLevel(0.25, 2)).toBeGreaterThan(0.5);
    expect(chordWidth(1.2, 2.4, 2.4)).toBeCloseTo(2.4, 9);
    expect(chordWidth(0, 2.4, 2.4)).toBeCloseTo(0, 9);
  });

  it('finds compartments along the barrel and fits pressure-vessel heads inside the cargo length', () => {
    const v = createVehicle('tanker-semi-32k');
    const cs = v.bulk!.compartments;
    expect(compartmentAtX(v, 0.1)?.id).toBe(cs[0].id);
    expect(compartmentAtX(v, cs[2].fromX + 0.01)?.id).toBe(cs[2].id);
    expect(compartmentAtX(v, 99)?.id).toBe(cs[cs.length - 1].id);
    expect(tankBarrel(v)).toMatchObject({ x0: 0, x1: v.cargo.l });
    const lpg = createVehicle('tanker-lpg-44k');
    const b = tankBarrel(lpg);
    expect(b.head).toBeCloseTo(lpg.cargo.h / 2, 9);
    expect(b.x1 + b.head).toBeCloseTo(lpg.cargo.l, 9);
  });

  it('packaged liquids: IBC level and drum keys follow the contents', () => {
    const ibc = makeSpec({ name: 'IBC tote', packaging: 'ibc', dims: { l: 1.2, w: 1, h: 1.15 }, weightKg: 900, material: { materialId: 'water', name: 'Water', state: 'liquid', densityKgPerL: 1, volumeL: 525 } });
    expect(liquidFraction(ibc)).toBeCloseTo(0.5, 9);
    expect(goodsArchetype(makeSpec({ name: 'Fuel can', packaging: 'jerrycan', dims: { l: 0.36, w: 0.17, h: 0.47 }, weightKg: 18 }))).toBe('jerrycan');
    const model = buildGoodsModel(ibc);
    expect(model.film).not.toBeNull();
    disposeGoodsModel(model);
  });
});

describe('tipper geometry', () => {
  it('heap shape conserves volume, grows monotonically and rises over the sides when overfilled', () => {
    const [l, w, h] = [5.8, 2.3, 1.2];
    expect(heapShape(0, l, w, h)).toMatchObject({ level: 0, mound: 0 });
    let prev = -1;
    for (let i = 1; i <= 12; i++) {
      const f = i / 10;
      const s = heapShape(f, l, w, h);
      expect(s.level).toBeGreaterThanOrEqual(0);
      expect(heapVolume(s, l, w)).toBeCloseTo(f * l * w * h, 6);
      expect(s.level + s.mound).toBeGreaterThan(prev);
      prev = s.level + s.mound;
    }
    expect(heapShape(1.2, l, w, h).level).toBeGreaterThan(h);
  });

  it('tips about the rear hinge: front rises, hinge stays, distances are preserved', () => {
    const angle = Math.PI / 4;
    const hinge = { x: 5.8, z: -0.16 };
    expect(tipPoint(angle, hinge.x, hinge.z, hinge.x, hinge.z)).toEqual(hinge);
    const front = tipPoint(angle, hinge.x, hinge.z, 0, -0.16);
    expect(front.z).toBeCloseTo(-0.16 + 5.8 * Math.sin(angle), 9);
    expect(front.x).toBeCloseTo(5.8 - 5.8 * Math.cos(angle), 9);
    const top = tipPoint(angle, hinge.x, hinge.z, hinge.x, 1.0);
    expect(top.x).toBeGreaterThan(hinge.x);
    const p = tipPoint(0.3, hinge.x, hinge.z, 2, 0.8);
    expect(Math.hypot(p.x - hinge.x, p.z - hinge.z)).toBeCloseTo(Math.hypot(2 - hinge.x, 0.8 - hinge.z), 9);
  });

  it('unload timeline rises to 45°, empties the body and lowers again', () => {
    expect(tipTimeline(0)).toEqual({ angle: 0, out: 0 });
    expect(tipTimeline(0.5).angle).toBeCloseTo(MAX_TIP, 9);
    expect(tipTimeline(0.8).out).toBe(1);
    expect(tipTimeline(1).angle).toBeCloseTo(0, 9);
  });

  it('sizes Indonesian cab-overs by class and keeps the front axle under the cab', () => {
    for (const id of ['id-pickup', 'id-cde-box', 'id-fuso-box', 'id-tronton-wingbox', 'id-dump-tronton']) {
      const v = createVehicle(id);
      const layout = vehicleLayout(v);
      expect(cabOverClass(v)).not.toBeNull();
      expect(layout.cab.fromX).toBeLessThan(layout.groupX[0]);
      expect(layout.cab.toX).toBeGreaterThan(layout.groupX[0]);
    }
    expect(cabOverClass(createVehicle('id-pickup'))).toBe('pickup');
    expect(cabOverClass(createVehicle('id-dump-tronton'))).toBe('heavy');
    expect(cabOverClass(createVehicle('eu-rigid-18'))).toBeNull();
  });
});
