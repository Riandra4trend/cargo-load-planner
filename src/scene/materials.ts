import { BoxGeometry, CylinderGeometry, DoubleSide, LineBasicMaterial, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Shared, never-disposed geometries and materials (created once per page). */

/** Centred unit cube. */
export const UNIT_BOX = new BoxGeometry(1, 1, 1);
/** Centred unit cylinder along Y (diameter 1, height 1). */
export const UNIT_CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 28, 1);
/** Low-poly wheel along Y. */
export const WHEEL_CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 22, 1);
/** Unit plane facing +Z. */
export const UNIT_PLANE = new PlaneGeometry(1, 1);

/**
 * Pallet in unit space (centred, Y up): a top deck over three runners, so pallet bases read as
 * pallets rather than slabs when scaled to a unit's footprint and pallet height.
 */
export const UNIT_PALLET: BufferGeometry = (() => {
  const part = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => new BoxGeometry(sx, sy, sz).translate(x, y, z);
  const geometry = mergeGeometries([
    part(1, 0.3, 1, 0, 0.35, 0),
    part(1, 0.7, 0.16, 0, -0.15, -0.42),
    part(1, 0.7, 0.16, 0, -0.15, 0),
    part(1, 0.7, 0.16, 0, -0.15, 0.42),
    part(1, 0.12, 1, 0, -0.44, 0),
  ]);
  if (!geometry) throw new Error('pallet geometry');
  return geometry;
})();

export const solid = (color: string, roughness = 0.75, metalness = 0.05) => new MeshStandardMaterial({ color, roughness, metalness });

export const glass = (color: string, opacity: number) =>
  new MeshStandardMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide, roughness: 0.4, metalness: 0 });

export const MATERIALS = {
  tyre: solid('#2b2b2b', 0.9),
  rim: solid('#b8bcc2', 0.35, 0.6),
  hub: solid('#6b7076', 0.5, 0.4),
  chassis: solid('#3a3d42', 0.7, 0.3),
  steel: solid('#8d939a', 0.45, 0.55),
  floor: solid('#d8d2c3', 0.85),
  deck: solid('#8a6a4a', 0.85),
  cab: solid('#f1f1ee', 0.45, 0.1),
  cabTrim: solid('#c9ccd1', 0.5, 0.2),
  windscreen: solid('#30404f', 0.15, 0.4),
  reefer: solid('#f7f7f5', 0.5),
  grille: solid('#55595e', 0.6, 0.3),
  wall: glass('#dfe7ef', 0.13),
  roof: glass('#e4ebf2', 0.08),
  door: glass('#eef1f4', 0.28),
  bulkhead: glass('#b9d8f0', 0.35),
  containerWall: glass('#4f7896', 0.16),
  ground: solid('#e8e6df', 1),
  dockSlab: solid('#cbc7bc', 0.95),
  dockFace: solid('#bdb8ac', 0.95),
  warehouseWall: glass('#d9d6cd', 0.2),
  doorFrame: solid('#8f949b', 0.5, 0.4),
  shutter: solid('#a7adb5', 0.5, 0.4),
  seal: solid('#2f3134', 0.95),
  bumper: solid('#1f2022', 0.9),
  leveller: solid('#7c8188', 0.5, 0.5),
  hazardYellow: solid('#f2c200', 0.6),
  forklift: solid('#f08c00', 0.45, 0.15),
  forkliftDark: solid('#2d2f33', 0.7, 0.3),
  forks: solid('#55595e', 0.4, 0.6),
} as const;

export const LINE_MATERIALS = {
  frame: new LineBasicMaterial({ color: '#59606a', transparent: true, opacity: 0.75 }),
  bay: new LineBasicMaterial({ color: '#8e897c', transparent: true, opacity: 0.55 }),
  /** COG plumb line: drawn through the cargo so it is never hidden. */
  cog: new LineBasicMaterial({ color: '#1d1d1b', depthTest: false, transparent: true }),
};

/** COG sphere drawn on top of everything (it usually sits inside the cargo). */
export const COG_OVERLAY = new MeshBasicMaterial({ color: '#f59e0b', depthTest: false, transparent: true });
