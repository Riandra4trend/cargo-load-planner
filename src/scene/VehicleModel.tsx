import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { MeshBasicMaterial, MeshStandardMaterial, Object3D, type InstancedMesh } from 'three';
import { TEMP_COLORS } from '../domain/colors';
import type { TempClass, Vehicle } from '../domain/types';
import { toThree } from './coords';
import { LINE_MATERIALS, MATERIALS, UNIT_BOX, UNIT_PLANE, WHEEL_CYLINDER } from './materials';
import { boxEdgePoints, CBox, CCyl, CLines, FloorRect } from './prims';
import { floorLabelTexture } from './textures';
import { vehicleLayout, type VehicleLayout } from './vehicleLayout';

const TYRE_W = 0.3;

/** Static vehicle model (primitives) around the cargo space; cargo floor at y = 0. */
export const VehicleModel = memo(function VehicleModel({ vehicle }: { vehicle: Vehicle }) {
  const layout = useMemo(() => vehicleLayout(vehicle), [vehicle]);
  return (
    <group>
      <Wheels vehicle={vehicle} layout={layout} />
      {layout.artic ? <Tractor vehicle={vehicle} layout={layout} /> : <RigidCab vehicle={vehicle} layout={layout} />}
      {layout.artic && <TrailerChassis vehicle={vehicle} />}
      {vehicle.kind === 'flatbed' ? <FlatbedDeck vehicle={vehicle} /> : <CargoBody vehicle={vehicle} />}
      <ZoneFloor vehicle={vehicle} />
      <Bays vehicle={vehicle} />
    </group>
  );
});

function Wheels({ vehicle, layout }: { vehicle: Vehicle; layout: VehicleLayout }) {
  const r = layout.wheelRadius;
  const z = -vehicle.deckHeight + r;
  const w = vehicle.cargo.w;
  return (
    <group>
      {layout.axles.map((a, i) => {
        const ys = a.dual ? [TYRE_W / 2 + 0.02, TYRE_W * 1.5 + 0.05, w - TYRE_W / 2 - 0.02, w - TYRE_W * 1.5 - 0.05] : [TYRE_W / 2 + 0.02, w - TYRE_W / 2 - 0.02];
        return (
          <group key={i}>
            {ys.map((y) => (
              <group key={y}>
                <CCyl centre={[a.x, y, z]} radius={r} length={TYRE_W} axis={1} material={MATERIALS.tyre} geometry={WHEEL_CYLINDER} />
                <CCyl centre={[a.x, y, z]} radius={r * 0.56} length={TYRE_W + 0.012} axis={1} material={MATERIALS.rim} geometry={WHEEL_CYLINDER} />
              </group>
            ))}
            <CCyl centre={[a.x, w / 2, z]} radius={0.07} length={w - 0.3} axis={1} material={MATERIALS.chassis} />
          </group>
        );
      })}
    </group>
  );
}

function Tractor({ vehicle, layout }: { vehicle: Vehicle; layout: VehicleLayout }) {
  const { cab, hood, frame } = layout;
  const w = vehicle.cargo.w;
  const ground = -vehicle.deckHeight;
  const front = hood ? hood.fromX : cab.fromX;
  const windscreenBottom = hood ? hood.topZ + 0.12 : cab.topZ - 1.15;
  return (
    <group>
      <CBox min={[cab.fromX, 0.02, cab.bottomZ]} max={[cab.toX, w - 0.02, cab.topZ]} material={MATERIALS.cab} />
      <CBox min={[cab.fromX - 0.012, 0.18, windscreenBottom]} max={[cab.fromX + 0.05, w - 0.18, Math.min(cab.topZ - 0.35, windscreenBottom + 0.85)]} material={MATERIALS.windscreen} />
      <CBox min={[cab.fromX + 0.15, 0.01, windscreenBottom + 0.05]} max={[cab.fromX + 0.9, w - 0.01, Math.min(cab.topZ - 0.4, windscreenBottom + 0.75)]} material={MATERIALS.windscreen} />
      {hood && (
        <>
          <CBox min={[hood.fromX, 0.32, ground + 0.62]} max={[hood.toX, w - 0.32, hood.topZ]} material={MATERIALS.cab} />
          <CBox min={[hood.fromX - 0.03, 0.55, ground + 0.75]} max={[hood.fromX + 0.02, w - 0.55, hood.topZ - 0.1]} material={MATERIALS.grille} />
          <CCyl centre={[cab.toX + 0.1, 0.3, (ground + 1.2 + cab.topZ + 0.45) / 2]} radius={0.07} length={cab.topZ + 0.45 - ground - 1.2} axis={2} material={MATERIALS.steel} />
        </>
      )}
      <CBox min={[front - 0.18, 0.1, ground + 0.35]} max={[front + 0.02, w - 0.1, ground + 0.68]} material={MATERIALS.chassis} />
      <CBox min={[frame.fromX, w / 2 - 0.5, frame.bottomZ]} max={[frame.toX, w / 2 - 0.38, frame.topZ]} material={MATERIALS.chassis} />
      <CBox min={[frame.fromX, w / 2 + 0.38, frame.bottomZ]} max={[frame.toX, w / 2 + 0.5, frame.topZ]} material={MATERIALS.chassis} />
      <CCyl centre={[(cab.fromX + cab.toX) / 2, 0.36, ground + 0.78]} radius={0.27} length={Math.min(1.2, cab.toX - cab.fromX - 0.2)} axis={0} material={MATERIALS.steel} />
      {layout.fifthWheelX !== null && <CCyl centre={[layout.fifthWheelX, w / 2, frame.topZ + 0.05]} radius={0.5} length={0.1} axis={2} material={MATERIALS.chassis} />}
    </group>
  );
}

function RigidCab({ vehicle, layout }: { vehicle: Vehicle; layout: VehicleLayout }) {
  const { cab, hood, frame } = layout;
  const w = vehicle.cargo.w;
  const ground = -vehicle.deckHeight;
  const front = hood ? hood.fromX : cab.fromX;
  const windscreenBottom = hood ? hood.topZ + 0.05 : cab.topZ - 1.05;
  return (
    <group>
      <CBox min={[cab.fromX, 0.01, cab.bottomZ]} max={[cab.toX, w - 0.01, cab.topZ]} material={MATERIALS.cab} />
      {hood && <CBox min={[hood.fromX, 0.04, cab.bottomZ]} max={[hood.toX, w - 0.04, hood.topZ]} material={MATERIALS.cab} />}
      <CBox min={[cab.fromX - 0.012, 0.12, windscreenBottom]} max={[cab.fromX + 0.05, w - 0.12, cab.topZ - 0.12]} material={MATERIALS.windscreen} />
      <CBox min={[cab.fromX + 0.12, 0.0, windscreenBottom + 0.04]} max={[cab.fromX + Math.min(0.85, (cab.toX - cab.fromX) * 0.7), w, cab.topZ - 0.18]} material={MATERIALS.windscreen} />
      <CBox min={[front - 0.12, 0.05, cab.bottomZ - 0.05]} max={[front + 0.02, w - 0.05, cab.bottomZ + 0.25]} material={MATERIALS.chassis} />
      <CBox min={[frame.fromX, w / 2 - 0.45, frame.bottomZ]} max={[frame.toX, w / 2 - 0.33, frame.topZ]} material={MATERIALS.chassis} />
      <CBox min={[frame.fromX, w / 2 + 0.33, frame.bottomZ]} max={[frame.toX, w / 2 + 0.45, frame.topZ]} material={MATERIALS.chassis} />
      <CBox min={[vehicle.cargo.l - 0.25, 0.1, ground + 0.45]} max={[vehicle.cargo.l - 0.12, w - 0.1, ground + 0.58]} material={MATERIALS.chassis} />
    </group>
  );
}

function TrailerChassis({ vehicle }: { vehicle: Vehicle }) {
  if (vehicle.statics.type !== 'artic') return null;
  const s = vehicle.statics;
  const { l, w } = vehicle.cargo;
  const ground = -vehicle.deckHeight;
  const g = s.trailerAxle;
  const legX = Math.min(s.kingpinX + 1.9, l * 0.3);
  const subFrom = g.x - g.spread / 2 - 0.7;
  const subTo = g.x + g.spread / 2 + 0.7;
  return (
    <group>
      <CBox min={[0.2, w / 2 - 0.55, -0.5]} max={[l - 0.2, w / 2 - 0.45, -0.16]} material={MATERIALS.chassis} />
      <CBox min={[0.2, w / 2 + 0.45, -0.5]} max={[l - 0.2, w / 2 + 0.55, -0.16]} material={MATERIALS.chassis} />
      <CCyl centre={[s.kingpinX, w / 2, -0.24]} radius={0.06} length={0.16} axis={2} material={MATERIALS.steel} />
      {[0.35, w - 0.35].map((y) => (
        <group key={y}>
          <CBox min={[legX - 0.07, y - 0.07, ground + 0.12]} max={[legX + 0.07, y + 0.07, -0.16]} material={MATERIALS.steel} />
          <CBox min={[legX - 0.16, y - 0.16, ground]} max={[legX + 0.16, y + 0.16, ground + 0.06]} material={MATERIALS.chassis} />
        </group>
      ))}
      <CBox min={[subFrom, w / 2 - 0.6, -0.78]} max={[subTo, w / 2 - 0.48, -0.5]} material={MATERIALS.chassis} />
      <CBox min={[subFrom, w / 2 + 0.48, -0.78]} max={[subTo, w / 2 + 0.6, -0.5]} material={MATERIALS.chassis} />
      <CBox min={[l - 0.4, 0.15, ground + 0.48]} max={[l - 0.28, w - 0.15, ground + 0.6]} material={MATERIALS.chassis} />
      {[0.5, w - 0.5].map((y) => (
        <CBox key={y} min={[l - 0.4, y - 0.04, ground + 0.48]} max={[l - 0.32, y + 0.04, -0.16]} material={MATERIALS.chassis} />
      ))}
    </group>
  );
}

/** Enclosed cargo body: floor, translucent walls/roof, frame, open rear doors, reefer unit, ribs on containers. */
function CargoBody({ vehicle }: { vehicle: Vehicle }) {
  const { l, w, h } = vehicle.cargo;
  const container = vehicle.kind === 'container';
  const wallMat = container ? MATERIALS.containerWall : MATERIALS.wall;
  const edges = useMemo(() => boxEdgePoints([0, -0.04, -0.16], [l, w + 0.04, h + 0.06]), [l, w, h]);
  const doorW = w / 2;
  return (
    <group>
      <CBox min={[0, 0, -0.16]} max={[l, w, 0]} material={MATERIALS.floor} />
      <CBox min={[0, -0.04, 0]} max={[l, 0, h]} material={wallMat} />
      <CBox min={[0, w, 0]} max={[l, w + 0.04, h]} material={wallMat} />
      <CBox min={[-0.05, -0.04, 0]} max={[0, w + 0.04, h]} material={wallMat} />
      <CBox min={[0, -0.04, h]} max={[l, w + 0.04, h + 0.06]} material={MATERIALS.roof} />
      <CLines points={edges} />
      {/* rear door frame */}
      <CBox min={[l - 0.06, -0.07, -0.16]} max={[l + 0.02, 0.04, h + 0.06]} material={MATERIALS.doorFrame} />
      <CBox min={[l - 0.06, w - 0.04, -0.16]} max={[l + 0.02, w + 0.07, h + 0.06]} material={MATERIALS.doorFrame} />
      <CBox min={[l - 0.06, -0.07, h]} max={[l + 0.02, w + 0.07, h + 0.14]} material={MATERIALS.doorFrame} />
      {/* doors swung 270° and latched flat against the side walls */}
      {[-0.1, w + 0.06].map((y) => (
        <group key={y}>
          <CBox min={[l - doorW, y, 0.02]} max={[l - 0.03, y + 0.04, h]} material={MATERIALS.door} />
          <CLines points={boxEdgePoints([l - doorW, y, 0.02], [l - 0.03, y + 0.04, h])} />
          {[0.3, 0.7].map((f) => (
            <CCyl key={f} centre={[l - doorW * (1 - f), y < 0 ? y - 0.02 : y + 0.06, h / 2]} radius={0.016} length={h - 0.1} axis={2} material={MATERIALS.steel} />
          ))}
        </group>
      ))}
      {vehicle.tempControlled && (
        <group>
          <CBox min={[-0.45, 0.2, h * 0.42]} max={[-0.05, w - 0.2, h - 0.04]} material={MATERIALS.reefer} />
          <CBox min={[-0.47, 0.38, h * 0.5]} max={[-0.44, w - 0.38, h - 0.2]} material={MATERIALS.grille} />
        </group>
      )}
      {container && <ContainerRibs vehicle={vehicle} />}
    </group>
  );
}

const RIB_PITCH = 0.28;

function ContainerRibs({ vehicle }: { vehicle: Vehicle }) {
  const ref = useRef<InstancedMesh>(null);
  const { l, w, h } = vehicle.cargo;
  const perSide = Math.max(1, Math.floor(l / RIB_PITCH));
  const count = perSide * 2 + 8;
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    let i = 0;
    for (let k = 0; k < perSide; k++) {
      const x = (k + 0.5) * (l / perSide);
      for (const y of [-0.06, w + 0.06]) {
        o.position.set(...toThree(x, y, h / 2));
        o.scale.set(0.07, h, 0.03);
        o.updateMatrix();
        mesh.setMatrixAt(i++, o.matrix);
      }
    }
    for (const x of [0.08, l - 0.08]) {
      for (const y of [0.08, w - 0.08]) {
        for (const z of [0.05, h + 0.02]) {
          o.position.set(...toThree(x, y, z));
          o.scale.set(0.18, 0.14, 0.18);
          o.updateMatrix();
          mesh.setMatrixAt(i++, o.matrix);
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [l, w, h, perSide]);
  return <instancedMesh ref={ref} args={[UNIT_BOX, MATERIALS.containerWall, count]} />;
}

function FlatbedDeck({ vehicle }: { vehicle: Vehicle }) {
  const { l, w } = vehicle.cargo;
  const pockets = Math.max(2, Math.floor(l / 0.9));
  return (
    <group>
      <CBox min={[0, 0, -0.2]} max={[l, w, 0]} material={MATERIALS.deck} />
      <CBox min={[0, -0.03, -0.32]} max={[l, 0.02, 0]} material={MATERIALS.chassis} />
      <CBox min={[0, w - 0.02, -0.32]} max={[l, w + 0.03, 0]} material={MATERIALS.chassis} />
      <CBox min={[-0.1, 0, 0]} max={[0, w, 1.3]} material={MATERIALS.steel} />
      {Array.from({ length: pockets }, (_, i) => (i + 0.5) * (l / pockets)).map((x) => (
        <group key={x}>
          <CBox min={[x - 0.05, -0.06, -0.25]} max={[x + 0.05, -0.02, -0.05]} material={MATERIALS.chassis} />
          <CBox min={[x - 0.05, w + 0.02, -0.25]} max={[x + 0.05, w + 0.06, -0.05]} material={MATERIALS.chassis} />
        </group>
      ))}
    </group>
  );
}

const zoneMaterials = new Map<TempClass, MeshStandardMaterial>();
function zoneMaterial(temp: TempClass): MeshStandardMaterial {
  let m = zoneMaterials.get(temp);
  if (!m) {
    m = new MeshStandardMaterial({ color: TEMP_COLORS[temp], transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.9 });
    zoneMaterials.set(temp, m);
  }
  return m;
}

/** Zone-tinted floor strips and bulkhead panels where adjacent zones differ in temperature. */
function ZoneFloor({ vehicle }: { vehicle: Vehicle }) {
  const { w, h } = vehicle.cargo;
  const zones = [...vehicle.zones].sort((a, b) => a.fromX - b.fromX);
  if (!vehicle.tempControlled && zones.every((z) => z.temp === 'ambient')) return null;
  return (
    <group>
      {zones.map((z) => (
        <FloorRect key={z.id} minX={z.fromX} maxX={z.toX} minY={0} maxY={w} z={0.003} material={zoneMaterial(z.temp)} />
      ))}
      {zones.slice(1).map((z, i) =>
        z.temp === zones[i].temp ? null : (
          <group key={`bh-${z.id}`}>
            <CBox min={[z.fromX - 0.03, 0.02, 0]} max={[z.fromX + 0.03, w - 0.02, h - 0.02]} material={MATERIALS.bulkhead} />
            <CLines points={boxEdgePoints([z.fromX - 0.03, 0.02, 0], [z.fromX + 0.03, w - 0.02, h - 0.02])} />
          </group>
        ),
      )}
    </group>
  );
}

const labelMaterials = new Map<string, MeshBasicMaterial>();
export function labelMaterial(text: string, color: string, aspect: number): MeshBasicMaterial {
  const key = `${text}:${color}:${aspect}`;
  let m = labelMaterials.get(key);
  if (!m) {
    m = new MeshBasicMaterial({ map: floorLabelTexture(text, color, aspect), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    labelMaterials.set(key, m);
  }
  return m;
}

/** Numbered floor bays (B.01 …): divider lines plus labels on the floor and on the left side rail. */
function Bays({ vehicle }: { vehicle: Vehicle }) {
  const { l, w } = vehicle.cargo;
  const count = Math.max(1, Math.ceil(l / vehicle.bayLength - 1e-9));
  const lines = useMemo(() => {
    const pts: number[] = [];
    for (let i = 1; i < count; i++) pts.push(i * vehicle.bayLength, 0, 0.006, i * vehicle.bayLength, w, 0.006);
    return pts;
  }, [count, vehicle.bayLength, w]);
  const railZ = vehicle.kind === 'flatbed' ? -0.16 : -0.08;
  const railY = vehicle.kind === 'flatbed' ? -0.035 : -0.045;
  return (
    <group>
      <CLines points={lines} material={LINE_MATERIALS.bay} />
      {Array.from({ length: count }, (_, i) => {
        const label = `B.${String(i + 1).padStart(2, '0')}`;
        const cx = Math.min(l, (i + 0.5) * vehicle.bayLength);
        const width = Math.min(0.5, vehicle.bayLength * 0.6);
        return (
          <group key={label}>
            <FloorRect minX={cx - width / 2} maxX={cx + width / 2} minY={0.05} maxY={0.05 + width / 3} z={0.008} material={labelMaterial(label, '#6f6a5e', 3)} />
            <mesh geometry={UNIT_PLANE} material={labelMaterial(label, '#4a4740', 3)} position={toThree(cx, railY, railZ)} scale={[width * 0.8, (width * 0.8) / 3, 1]} />
          </group>
        );
      })}
    </group>
  );
}
