import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, Matrix4, MeshStandardMaterial, Object3D, SphereGeometry, type InstancedMesh } from 'three';
import { makeSpec } from '../data/seed';
import type { ItemSpec, Vec3, Vehicle } from '../domain/types';
import { toThree } from './coords';
import { GOODS_FILM, GOODS_SOLID, goodsModelFor, useRetainGoods } from './goods/cache';
import { goodsInstanceMatrix } from './goods/orientation';
import { MATERIALS, UNIT_BOX, WHEEL_CYLINDER } from './materials';
import { CBox, CCyl } from './prims';
import { RACK_BAY, type DockLayout } from './staging';
import { grainTexture } from './textures';

const RACK_LEVELS = [0, 1.55, 3.05];
const RACK_HEIGHT = 4.3;
const UPRIGHT = new MeshStandardMaterial({ color: '#1f4e9a', roughness: 0.5, metalness: 0.4 });
const BEAM = new MeshStandardMaterial({ color: '#f08c00', roughness: 0.5, metalness: 0.3 });
const STOCK_TAG = new MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.6 });

/** Decorative warehouse stock (fit a 1.1 m deep rack slot under the 1.5 m beam pitch). */
const STOCK: ItemSpec[] = [
  makeSpec({ name: 'Stock cartons', packaging: 'eur-pallet', palletHeight: 0.144, dims: { l: 1.2, w: 0.8, h: 1.3 }, weightKg: 400 }),
  makeSpec({ name: 'Beverages stock', packaging: 'eur-pallet', palletHeight: 0.144, dims: { l: 1.2, w: 0.8, h: 1.25 }, weightKg: 600 }),
  makeSpec({ name: 'Drums on pallet', packaging: 'drum', palletHeight: 0.144, dims: { l: 1.2, w: 1.0, h: 1.1 }, weightKg: 700 }),
  makeSpec({ name: 'IBC tote stock', packaging: 'ibc', dims: { l: 1.2, w: 1.0, h: 1.15 }, weightKg: 1000 }),
];
/** Which stock item stands in each rack slot (-1 = empty), cycling through the bays. */
const STOCK_PATTERN = [0, 1, 0, 2, 3, 0, -1, 1, 0, 2, 0, 1, 3, -1, 0, 1, 2, 0];

/** Rack slot positions (minimum corners, cargo coordinates on the dock slab) with their stock item. */
export function rackStock(rack: DockLayout['rack']): { spec: number; pos: Vec3 }[] {
  const out: { spec: number; pos: Vec3 }[] = [];
  let n = 0;
  for (let bay = 0; bay < rack.bays; bay++) {
    for (const z of RACK_LEVELS) {
      for (let k = 0; k < 2; k++, n++) {
        const spec = STOCK_PATTERN[n % STOCK_PATTERN.length];
        if (spec < 0) continue;
        const dims = STOCK[spec].dims;
        const y = (rack.fromY + rack.toY) / 2 - dims.w / 2;
        out.push({ spec, pos: { x: rack.fromX + bay * RACK_BAY + 0.1 + k * 1.3, y, z: z + (z > 0 ? 0.1 : 0) } });
      }
    }
  }
  return out;
}

/** Pallet racking (instanced uprights and beams) stocked with realistic goods models. */
export const WarehouseRacks = memo(function WarehouseRacks({ rack }: { rack: DockLayout['rack'] }) {
  const uprights = useRef<InstancedMesh>(null);
  const beams = useRef<InstancedMesh>(null);
  const uprightCount = (rack.bays + 1) * 2;
  const beamCount = rack.bays * 2 * RACK_LEVELS.length;
  useLayoutEffect(() => {
    const o = new Object3D();
    const u = uprights.current;
    if (u) {
      let i = 0;
      for (let b = 0; b <= rack.bays; b++) {
        for (const y of [rack.fromY, rack.toY]) {
          o.position.set(...toThree(rack.fromX + b * RACK_BAY, y, RACK_HEIGHT / 2));
          o.scale.set(0.09, RACK_HEIGHT, 0.09);
          o.updateMatrix();
          u.setMatrixAt(i++, o.matrix);
        }
      }
      u.instanceMatrix.needsUpdate = true;
      u.computeBoundingSphere();
    }
    const bm = beams.current;
    if (bm) {
      let i = 0;
      for (let b = 0; b < rack.bays; b++) {
        for (const z of RACK_LEVELS) {
          for (const y of [rack.fromY, rack.toY]) {
            o.position.set(...toThree(rack.fromX + (b + 0.5) * RACK_BAY, y, z + 0.05));
            o.scale.set(RACK_BAY, 0.1, 0.06);
            o.updateMatrix();
            bm.setMatrixAt(i++, o.matrix);
          }
        }
      }
      bm.instanceMatrix.needsUpdate = true;
      bm.computeBoundingSphere();
    }
  }, [rack, uprightCount, beamCount]);
  const stock = useMemo(() => rackStock(rack), [rack]);
  return (
    <group>
      <instancedMesh ref={uprights} args={[UNIT_BOX, UPRIGHT, uprightCount]} castShadow />
      <instancedMesh ref={beams} args={[UNIT_BOX, BEAM, beamCount]} castShadow />
      {STOCK.map((spec, i) => (
        <StockModel key={spec.name} spec={spec} positions={stock.filter((s) => s.spec === i).map((s) => s.pos)} />
      ))}
    </group>
  );
});

/** One goods model instanced at several rack positions (orientation 0). */
function StockModel({ spec, positions }: { spec: ItemSpec; positions: Vec3[] }) {
  const model = goodsModelFor(spec);
  useRetainGoods([model.key]);
  const solid = useRef<InstancedMesh>(null);
  const tags = useRef<InstancedMesh>(null);
  const film = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new Matrix4();
    positions.forEach((pos, i) => {
      goodsInstanceMatrix(0, spec.dims, pos, m);
      for (const mesh of [solid.current, tags.current, film.current]) mesh?.setMatrixAt(i, m);
    });
    for (const mesh of [solid.current, tags.current, film.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [positions, spec.dims, model]);
  if (!positions.length) return null;
  return (
    <group>
      <instancedMesh ref={solid} args={[model.solid, GOODS_SOLID, positions.length]} castShadow receiveShadow />
      {model.tags && <instancedMesh ref={tags} args={[model.tags, STOCK_TAG, positions.length]} />}
      {model.film && <instancedMesh ref={film} args={[model.film, GOODS_FILM, positions.length]} />}
    </group>
  );
}

const GANTRY = new MeshStandardMaterial({ color: '#f2b705', roughness: 0.5, metalness: 0.3 });

/** Tanker loading gantry on the far side of the truck: tower, platform level with the tank top and a parked loading arm. */
export const TankerGantry = memo(function TankerGantry({ vehicle }: { vehicle: Vehicle }) {
  const { l, w, h } = vehicle.cargo;
  const ground = -vehicle.deckHeight;
  const x = Math.max(1, l - 2.2);
  const top = h + 0.9;
  return (
    <group>
      {[x - 0.6, x + 0.6].flatMap((px) =>
        [w + 1.5, w + 2.3].map((py) => <CBox key={`${px}:${py}`} min={[px - 0.08, py - 0.08, ground]} max={[px + 0.08, py + 0.08, top]} material={GANTRY} />),
      )}
      <CBox min={[x - 0.8, w + 0.3, top]} max={[x + 0.8, w + 2.5, top + 0.1]} material={MATERIALS.steel} />
      {/* handrails */}
      {[x - 0.8, x + 0.75].map((px) => (
        <CBox key={px} min={[px, w + 0.3, top + 0.1]} max={[px + 0.05, w + 2.5, top + 1.1]} material={GANTRY} />
      ))}
      <CBox min={[x - 0.8, w + 2.45, top + 1.05]} max={[x + 0.8, w + 2.5, top + 1.1]} material={GANTRY} />
      {/* loading arm parked over the tank */}
      <CCyl centre={[x, (w / 2 + w + 0.4) / 2, top + 0.6]} radius={0.07} length={w / 2 + 0.4} axis={1} material={MATERIALS.steel} />
      <CCyl centre={[x, w / 2, (h + 0.45 + top + 0.6) / 2]} radius={0.075} length={top + 0.6 - h - 0.45} axis={2} material={MATERIALS.forklift} />
    </group>
  );
});

const DOME = new SphereGeometry(0.5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);

/** Dump-truck site: a stockpile of the plan's dry bulk material and a parked wheel loader. */
export const DumpSite = memo(function DumpSite({ vehicle, color }: { vehicle: Vehicle; color: string }) {
  const { l, w } = vehicle.cargo;
  const ground = -vehicle.deckHeight;
  const pile = useMemo(() => new MeshStandardMaterial({ color: new Color(color), map: grainTexture(), roughness: 0.95 }), [color]);
  return (
    <group>
      <mesh geometry={DOME} material={pile} position={toThree(l + 4, w + 3.6, ground)} scale={[6, 4, 5.2]} castShadow receiveShadow />
      <WheelLoader x={l + 2.6} y={-3.2} ground={ground} />
    </group>
  );
});

const LOADER = new MeshStandardMaterial({ color: '#f2b705', roughness: 0.5, metalness: 0.2 });

/** Wheel loader from primitives, bucket toward -x, standing at cargo (x, y) on the ground. */
function WheelLoader({ x, y, ground }: { x: number; y: number; ground: number }) {
  const r = 0.72;
  const g = ground;
  return (
    <group>
      {[x + 0.4, x + 2.6].flatMap((ax) =>
        [y - 1.05, y + 1.05].map((wy) => <CCyl key={`${ax}:${wy}`} centre={[ax, wy, g + r]} radius={r} length={0.55} axis={1} material={MATERIALS.tyre} geometry={WHEEL_CYLINDER} />),
      )}
      <CBox min={[x - 0.2, y - 0.75, g + 0.6]} max={[x + 1.2, y + 0.75, g + 1.5]} material={LOADER} />
      <CBox min={[x + 1.2, y - 0.85, g + 0.7]} max={[x + 3.4, y + 0.85, g + 1.9]} material={LOADER} />
      <CBox min={[x + 1.3, y - 0.7, g + 1.9]} max={[x + 2.4, y + 0.7, g + 3.2]} material={MATERIALS.windscreen} />
      <CBox min={[x + 1.25, y - 0.75, g + 3.15]} max={[x + 2.45, y + 0.75, g + 3.25]} material={LOADER} />
      <CBox min={[x + 3.1, y - 0.6, g + 1.9]} max={[x + 3.3, y + 0.6, g + 2.3]} material={MATERIALS.grille} />
      {/* boom arms and bucket */}
      {[y - 0.55, y + 0.45].map((by) => (
        <CBox key={by} min={[x - 1.2, by, g + 1.0]} max={[x + 0.6, by + 0.1, g + 1.25]} material={LOADER} />
      ))}
      <CBox min={[x - 1.9, y - 1.3, g + 0.05]} max={[x - 1.15, y + 1.3, g + 1.05]} material={MATERIALS.chassis} />
    </group>
  );
}
