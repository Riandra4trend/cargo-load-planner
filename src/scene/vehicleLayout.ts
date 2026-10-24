import type { Vehicle } from '../domain/types';
import { axleGroups, axlePositions } from '../physics';

/** One axle drawn under the vehicle (cargo x of the axle line). */
export interface WheelAxle {
  x: number;
  groupIndex: number;
  dual: boolean;
}

/** Cargo-coordinate placement of every vehicle part drawn around the cargo space. */
export interface VehicleLayout {
  artic: boolean;
  wheelRadius: number;
  /** Axle-group centres (order of physics.axleGroups), cargo x. */
  groupX: number[];
  axles: WheelAxle[];
  /** Cargo x of the tractor frame origin (steer axle): tractor frame t maps to x = tractorX + t. */
  tractorX: number;
  /** Cab (cargo x range, z range; z negative = below the cargo floor). */
  cab: { fromX: number; toX: number; bottomZ: number; topZ: number };
  hood: { fromX: number; toX: number; topZ: number } | null;
  /** Chassis rails (cargo x range, z range): tractor frame or rigid chassis. */
  frame: { fromX: number; toX: number; bottomZ: number; topZ: number };
  /** Fifth-wheel centre, cargo x (articulated only). */
  fifthWheelX: number | null;
  /** Overall extents in cargo coordinates (used to fit cameras). */
  extents: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

/** Gap between the back of the tractor cab and the trailer front wall, metres. */
const CAB_GAP = 0.95;

export type CabOverClass = 'pickup' | 'light' | 'medium' | 'heavy';

/** Cab-over cab size per truck class: length along the vehicle and roof height above the ground, metres. */
const CAB_OVER: Record<CabOverClass, { length: number; height: number }> = {
  pickup: { length: 1.3, height: 1.9 },
  light: { length: 1.55, height: 2.4 },
  medium: { length: 1.85, height: 2.8 },
  heavy: { length: 2.05, height: 3.05 },
};

/** Rigid Indonesian trucks are cab-overs sized by class (pick-up, CDE / CDD, Fuso, tronton); others use the generic cab. */
export function cabOverClass(v: Vehicle): CabOverClass | null {
  if (v.statics.type !== 'rigid' || v.region !== 'ID') return null;
  if (v.body === 'dropside' && v.grossLimitKg <= 3500) return 'pickup';
  if (v.grossLimitKg <= 9000) return 'light';
  if (v.grossLimitKg <= 17_000) return 'medium';
  return 'heavy';
}

export function vehicleLayout(v: Vehicle): VehicleLayout {
  const s = v.statics;
  const ground = -v.deckHeight;
  const wheelRadius = Math.min(0.52, Math.max(0.3, v.deckHeight * 0.4));
  const groups = axleGroups(v);
  const roofZ = v.walls ? v.cargo.h + 0.08 : 0;
  let tractorX = 0;
  let groupX: number[];
  let cab: VehicleLayout['cab'];
  let hood: VehicleLayout['hood'] = null;
  let frame: VehicleLayout['frame'];
  let fifthWheelX: number | null = null;

  if (s.type === 'artic') {
    // Tractor frame t (steer axle = 0) maps to cargo x = kingpinX - (fifthWheelX - t).
    tractorX = s.kingpinX - s.fifthWheelX;
    groupX = [tractorX + s.steer.x, tractorX + s.drive.x, s.trailerAxle.x];
    fifthWheelX = s.kingpinX;
    const cabEnd = Math.min(tractorX + s.fifthWheelX - 0.9, -CAB_GAP - (v.tempControlled ? 0.3 : 0));
    const topZ = Math.max(v.cargo.h - 0.15, ground + 3.2);
    if (v.region === 'US') {
      hood = { fromX: tractorX - 1.35, toX: tractorX + 0.85, topZ: ground + 1.75 };
      cab = { fromX: tractorX + 0.85, toX: Math.max(tractorX + 2.4, cabEnd), bottomZ: ground + 0.6, topZ };
    } else {
      cab = { fromX: tractorX - 1.45, toX: Math.max(tractorX + 0.7, cabEnd), bottomZ: ground + 0.6, topZ };
    }
    frame = {
      fromX: tractorX - 1.3,
      toX: tractorX + s.drive.x + s.drive.spread / 2 + 0.75,
      bottomZ: ground + 0.72,
      topZ: Math.min(ground + 1.0, -0.3),
    };
  } else {
    groupX = [s.front.x, s.rear.x];
    const van = v.kind === 'van';
    const cabOver = cabOverClass(v);
    if (cabOver) {
      // Cab-over (Asian light / medium / heavy trucks, pick-ups): the front axle sits under the cab.
      const size = CAB_OVER[cabOver];
      const toX = -0.1;
      cab = { fromX: Math.min(toX - size.length, s.front.x - size.length * 0.45), toX, bottomZ: ground + wheelRadius * 0.85, topZ: ground + size.height };
    } else {
      const cabLength = van ? 0.95 : 1.35;
      cab = {
        fromX: s.front.x - cabLength,
        toX: van ? 0 : -0.12,
        bottomZ: ground + wheelRadius * 0.9,
        topZ: van ? v.cargo.h * 0.78 : Math.max(v.cargo.h - 0.2, ground + 2.9),
      };
      if (van) hood = { fromX: s.front.x - cabLength - 0.25, toX: s.front.x + 0.15, topZ: ground + wheelRadius * 2.4 };
    }
    frame = { fromX: cab.fromX + 0.2, toX: v.cargo.l - 0.2, bottomZ: ground + wheelRadius * 1.1, topZ: -0.08 };
  }

  // axlePositions reports articulated axles in the tractor frame (trailer axles through the coupling).
  const axles: WheelAxle[] = axlePositions(v).map((a) => ({
    x: tractorX + a.pos,
    groupIndex: a.groupIndex,
    dual: v.kind !== 'van' && !groups[a.groupIndex].steer,
  }));

  return {
    artic: s.type === 'artic',
    wheelRadius,
    groupX,
    axles,
    tractorX,
    cab,
    hood,
    frame,
    fifthWheelX,
    extents: {
      minX: Math.min(cab.fromX, hood?.fromX ?? cab.fromX) - 0.2,
      maxX: v.cargo.l + 0.3,
      minY: -0.25,
      maxY: v.cargo.w + 0.25,
      minZ: ground,
      maxZ: Math.max(roofZ, cab.topZ),
    },
  };
}
