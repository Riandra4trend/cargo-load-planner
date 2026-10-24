import { compartmentFill, compartmentOf, expandUnits, footprintOverlap, placementBox, type Box } from '../domain/geometry';
import type { Id, Plan, Vehicle } from '../domain/types';

export interface LoadStep {
  unitId: Id;
  name: string;
  stopSeq: number;
  box: Box;
  /** 1 = on the floor, 2 = on top of one unit, ... */
  layer: number;
  /** "front left, floor" or "compartment C2, 96 % full" */
  position: string;
  /** Tanker fills: the compartment being filled (box = the liquid in it). */
  compartmentId?: Id;
}

const STACK_TOL = 0.02;

/** Human-readable position of a box inside a vehicle: "front left, floor", "rear centre, layer 2". */
export function describePosition(v: Vehicle, box: Box, layer: number): string {
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const along = cx < v.cargo.l / 3 ? 'front' : cx < (2 * v.cargo.l) / 3 ? 'middle' : 'rear';
  const across = cy < v.cargo.w / 3 ? 'left' : cy < (2 * v.cargo.w) / 3 ? 'centre' : 'right';
  return `${along} ${across}, ${layer === 1 ? 'floor' : `layer ${layer}`}`;
}

/**
 * Physical loading order. Tanker compartments fill front to rear; floor cargo follows a forklift working
 * from the rear doors: front-most stacks first, each stack bottom-up (a stacked unit inherits the front
 * edge of the floor unit it rests on).
 */
export function loadingSequence(plan: Plan, vehicleId: Id): LoadStep[] {
  const v = plan.vehicles.find((x) => x.id === vehicleId);
  if (!v) return [];
  const units = expandUnits(plan).filter((u) => plan.placements[u.id]?.vehicleId === vehicleId);
  const compartments = v.tank?.compartments ?? [];
  const fills: LoadStep[] = units
    .flatMap((u) => {
      const c = compartmentOf(v, plan.placements[u.id].compartmentId);
      if (!c) return [];
      const fill = compartmentFill(u.spec, c);
      const box: Box = { min: { x: c.fromX, y: 0, z: 0 }, max: { x: c.toX, y: v.cargo.w, z: Math.min(1, fill) * v.cargo.h } };
      return [{ unitId: u.id, name: u.spec.name, stopSeq: u.stopSeq, box, layer: 1, position: `compartment ${c.label}, ${Math.round(fill * 100)} % full`, compartmentId: c.id }];
    })
    .sort((a, b) => compartments.findIndex((c) => c.id === a.compartmentId) - compartments.findIndex((c) => c.id === b.compartmentId));
  const filled = new Set(fills.map((f) => f.unitId));
  const items = units
    .filter((u) => !filled.has(u.id))
    .map((u) => ({ u, box: placementBox(plan.placements[u.id], u.spec), rootX: 0, layer: 1 }))
    .sort((a, b) => a.box.min.z - b.box.min.z);
  for (const it of items) {
    if (it.box.min.z < STACK_TOL) {
      it.rootX = it.box.min.x;
      continue;
    }
    const supporters = items.filter((o) => o !== it && Math.abs(o.box.max.z - it.box.min.z) < STACK_TOL && footprintOverlap(o.box, it.box) > 0);
    it.rootX = supporters.length ? Math.min(...supporters.map((s) => s.rootX)) : it.box.min.x;
    it.layer = supporters.length ? Math.max(...supporters.map((s) => s.layer)) + 1 : 1;
  }
  items.sort((a, b) => a.rootX - b.rootX || a.box.min.z - b.box.min.z || a.box.min.y - b.box.min.y);
  return [
    ...fills,
    ...items.map(({ u, box, layer }) => ({
      unitId: u.id,
      name: u.spec.name,
      stopSeq: u.stopSeq,
      box,
      layer,
      position: describePosition(v, box, layer),
    })),
  ];
}
