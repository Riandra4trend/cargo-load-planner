import type { Box } from '../domain/geometry';
import type { Id, Vec3, Vehicle } from '../domain/types';

/** Gap between the rear of the cargo space and the dock face (bumpers + leveller lip), metres. */
export const DOCK_GAP = 0.45;
/** Free manoeuvring aisle between the dock face and the staging lanes, metres. */
const AISLE = 2.6;
/** Floor space at the head of each lane reserved for its painted label, metres. */
export const LABEL_SPACE = 1.7;
const UNIT_GAP = 0.3;
const LANE_GAP = 0.5;
const MAX_LANE_LENGTH = 9;

export interface StagingUnit {
  id: Id;
  stopId: Id;
  stopSeq: number;
  /** Oriented size as loaded (cargo axes). */
  size: Vec3;
}

export interface StagingLane {
  stopId: Id;
  stopSeq: number;
  /** Cargo-space floor rectangle of the lane (x beyond the dock face). */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface DockLayout {
  /** Dock face / warehouse wall position along cargo x. */
  wallX: number;
  /** Dock floor (warehouse slab) extent in cargo x / y. */
  floor: { minX: number; maxX: number; minY: number; maxY: number };
  lanes: StagingLane[];
  /** Where each unit waits before loading (box on the dock floor, z = 0). */
  slots: Map<Id, Box>;
  /** Forklift parking spot (fork heel, cargo x / y). */
  home: { x: number; y: number };
  /** Pallet racking along the far side of the lanes (cargo x / y footprint, number of bays). */
  rack: { fromX: number; toX: number; fromY: number; toY: number; bays: number };
}

/** Pallet racking: bays along the far side of the lanes, each bay 2.7 m wide and 1.1 m deep. */
export const RACK_BAY = 2.7;
const RACK_DEPTH = 1.1;
const RACK_BAYS = 3;
const RACK_START = 0.8;

/**
 * Dock behind the rear doors: one colour-coded staging lane per stop, side by side across the
 * vehicle's width and running away from the dock face. `units` must be in loading order; each
 * lane fills from its head (nearest the dock door) so the forklift always picks from the front.
 */
export function dockLayout(vehicle: Vehicle, units: readonly StagingUnit[]): DockLayout {
  const wallX = vehicle.cargo.l + DOCK_GAP;
  const startX = wallX + AISLE;
  const byStop = new Map<Id, StagingUnit[]>();
  for (const u of units) {
    const list = byStop.get(u.stopId);
    if (list) list.push(u);
    else byStop.set(u.stopId, [u]);
  }
  const groups = [...byStop.values()].sort((a, b) => a[0].stopSeq - b[0].stopSeq);

  // Lay every lane out at y = 0 first, then centre the set of lanes on the vehicle.
  const draft = groups.map((list) => {
    const colWidth = Math.max(...list.map((u) => u.size.y)) + 0.25;
    const placed: { id: Id; x: number; col: number; size: Vec3 }[] = [];
    let col = 0;
    let x = startX + LABEL_SPACE;
    let length = 0;
    for (const u of list) {
      if (x + u.size.x > startX + LABEL_SPACE + MAX_LANE_LENGTH && x > startX + LABEL_SPACE) {
        col++;
        x = startX + LABEL_SPACE;
      }
      placed.push({ id: u.id, x, col, size: u.size });
      x += u.size.x + UNIT_GAP;
      length = Math.max(length, x - startX);
    }
    return { list, colWidth, cols: col + 1, placed, length: Math.max(length, LABEL_SPACE + 1.5) };
  });
  const total = draft.reduce((s, d) => s + d.colWidth * d.cols, 0) + LANE_GAP * Math.max(0, draft.length - 1);
  let y = vehicle.cargo.w / 2 - total / 2;
  const lanes: StagingLane[] = [];
  const slots = new Map<Id, Box>();
  for (const d of draft) {
    const width = d.colWidth * d.cols;
    lanes.push({ stopId: d.list[0].stopId, stopSeq: d.list[0].stopSeq, minX: startX, maxX: startX + d.length, minY: y, maxY: y + width });
    for (const p of d.placed) {
      const cy = y + d.colWidth * (p.col + 0.5);
      const min = { x: p.x, y: cy - p.size.y / 2, z: 0 };
      slots.set(p.id, { min, max: { x: min.x + p.size.x, y: min.y + p.size.y, z: p.size.z } });
    }
    y += width + LANE_GAP;
  }
  const lanesMinY = lanes.length ? lanes[0].minY : 0;
  const lanesMaxY = lanes.length ? lanes[lanes.length - 1].maxY : vehicle.cargo.w;
  const lanesMaxX = lanes.reduce((m, l) => Math.max(m, l.maxX), startX + 4);
  const rackY0 = Math.max(vehicle.cargo.w + 1.2, lanesMaxY + 1.2);
  const floor = {
    minX: wallX,
    maxX: Math.max(lanesMaxX + 1.5, wallX + RACK_START + RACK_BAYS * RACK_BAY + 1),
    minY: Math.min(-3, lanesMinY - 1.5),
    maxY: rackY0 + RACK_DEPTH + 0.8,
  };
  return {
    wallX,
    floor,
    lanes,
    slots,
    home: { x: wallX + AISLE * 0.55, y: floor.minY + 1.2 },
    rack: { fromX: wallX + RACK_START, toX: wallX + RACK_START + RACK_BAYS * RACK_BAY, fromY: rackY0, toY: rackY0 + RACK_DEPTH, bays: RACK_BAYS },
  };
}
