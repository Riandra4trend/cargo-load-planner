import { memo, useMemo } from 'react';
import { CylinderGeometry, DoubleSide, MeshStandardMaterial, SphereGeometry } from 'three';
import type { Vehicle } from '../domain/types';
import { toThree } from './coords';
import { MATERIALS } from './materials';
import { CBox, CCyl, FloorRect } from './prims';
import { tankBarrel } from './tankMath';
import { labelMaterial } from './VehicleModel';

/** Unit cylinder along three X (length 1, diameter 1 across Y and Z): scale to (length, height, width). */
export const X_CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 56, 1).rotateZ(-Math.PI / 2);
/** Open-ended band along three X (rings, bands, outlines). */
export const X_BAND = new CylinderGeometry(0.5, 0.5, 1, 56, 1, true).rotateZ(-Math.PI / 2);
/** Half sphere bulging toward +X (rear head); mirror with a negative X scale for the front head. */
export const X_HEAD = new SphereGeometry(0.5, 40, 20, 0, Math.PI).rotateY(Math.PI / 2);

export const TANK_MATERIALS = {
  shell: new MeshStandardMaterial({ color: '#c9d2da', transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide, roughness: 0.3, metalness: 0.35 }),
  pressureShell: new MeshStandardMaterial({ color: '#f4f5f2', transparent: true, opacity: 0.42, depthWrite: false, side: DoubleSide, roughness: 0.35, metalness: 0.1 }),
  bulkhead: new MeshStandardMaterial({ color: '#9aa5b1', transparent: true, opacity: 0.3, depthWrite: false, side: DoubleSide, roughness: 0.4, metalness: 0.3 }),
  ring: new MeshStandardMaterial({ color: '#aeb6bf', roughness: 0.35, metalness: 0.55, side: DoubleSide }),
  pressureRing: new MeshStandardMaterial({ color: '#e6e8e3', roughness: 0.45, metalness: 0.2, side: DoubleSide }),
  grating: new MeshStandardMaterial({ color: '#7d858d', roughness: 0.6, metalness: 0.5 }),
  rail: new MeshStandardMaterial({ color: '#d8dde2', roughness: 0.35, metalness: 0.6 }),
  valveRed: new MeshStandardMaterial({ color: '#c92a2a', roughness: 0.5 }),
  cabinet: new MeshStandardMaterial({ color: '#c3c9cf', roughness: 0.45, metalness: 0.45 }),
};

/**
 * Static tank of a tanker (vehicle.kind === 'tanker'): elliptical (circular for pressure vessels)
 * semi-transparent barrel over the cargo box, end heads, bulkhead rings at compartment boundaries,
 * saddles, manholes with compartment labels (valve dome and relief valves on pressure vessels),
 * walkway with handrails, rear ladder, hose cabinet and bottom valves.
 */
export const TankModel = memo(function TankModel({ vehicle }: { vehicle: Vehicle }) {
  const { l, w, h } = vehicle.cargo;
  const compartments = vehicle.tank?.compartments ?? [];
  const pressurised = !!vehicle.tank?.pressurised;
  const { x0, x1, head } = tankBarrel(vehicle);
  const shell = pressurised ? TANK_MATERIALS.pressureShell : TANK_MATERIALS.shell;
  const ring = pressurised ? TANK_MATERIALS.pressureRing : TANK_MATERIALS.ring;
  const centre = toThree((x0 + x1) / 2, w / 2, h / 2);
  const posts = useMemo(() => {
    const n = Math.max(2, Math.round(l / 1.6) + 1);
    return Array.from({ length: n }, (_, i) => 0.35 + (i * (l - 0.7)) / (n - 1));
  }, [l]);
  const saddles = useMemo(() => {
    const n = Math.max(2, Math.round(l / 2.2) + 1);
    return Array.from({ length: n }, (_, i) => 0.3 + (i * (l - 0.6)) / (n - 1));
  }, [l]);
  const top = h + 0.02;
  return (
    <group>
      {/* barrel and heads */}
      <mesh geometry={X_CYLINDER} material={shell} position={centre} scale={[x1 - x0, h, w]} />
      <mesh geometry={X_HEAD} material={shell} position={toThree(x1, w / 2, h / 2)} scale={[head * 2, h, w]} />
      <mesh geometry={X_HEAD} material={shell} position={toThree(x0, w / 2, h / 2)} scale={[-head * 2, h, w]} />
      {[x0, x1].map((x) => (
        <mesh key={x} geometry={X_BAND} material={ring} position={toThree(x, w / 2, h / 2)} scale={[0.06, h * 1.015, w * 1.015]} />
      ))}
      {/* bulkheads between compartments */}
      {compartments.slice(1).map((c) => (
        <group key={c.id}>
          <mesh geometry={X_CYLINDER} material={TANK_MATERIALS.bulkhead} position={toThree(c.fromX, w / 2, h / 2)} scale={[0.02, h * 0.995, w * 0.995]} />
          <mesh geometry={X_BAND} material={ring} position={toThree(c.fromX, w / 2, h / 2)} scale={[0.05, h * 1.012, w * 1.012]} />
        </group>
      ))}
      {/* saddles on the chassis */}
      {saddles.map((x) => (
        <CBox key={x} min={[x - 0.08, w / 2 - 0.55, -0.16]} max={[x + 0.08, w / 2 + 0.55, h * 0.08]} material={MATERIALS.chassis} />
      ))}
      {pressurised ? (
        <group>
          {/* valve dome with relief valves in the middle of the vessel */}
          <CCyl centre={[l / 2, w / 2, h + 0.09]} radius={0.38} length={0.22} axis={2} material={TANK_MATERIALS.pressureRing} />
          {[-0.18, 0, 0.18].map((dx) => (
            <CCyl key={dx} centre={[l / 2 + dx, w / 2, h + 0.27]} radius={0.05} length={0.18} axis={2} material={TANK_MATERIALS.valveRed} />
          ))}
          <CBox min={[l / 2 - 0.8, w / 2 - 0.3, h - 0.01]} max={[l / 2 + 0.8, w / 2 + 0.3, h + 0.03]} material={TANK_MATERIALS.grating} />
        </group>
      ) : (
        <group>
          {/* walkway, handrails, manholes with compartment labels */}
          <CBox min={[0.2, w / 2 - 0.28, h - 0.01]} max={[l - 0.2, w / 2 + 0.28, top]} material={TANK_MATERIALS.grating} />
          {[w / 2 - 0.34, w / 2 + 0.31].map((y) => (
            <group key={y}>
              {posts.map((x) => (
                <CBox key={x} min={[x - 0.015, y, top]} max={[x + 0.015, y + 0.03, top + 0.45]} material={TANK_MATERIALS.rail} />
              ))}
              <CBox min={[posts[0] - 0.015, y, top + 0.43]} max={[posts[posts.length - 1] + 0.015, y + 0.03, top + 0.46]} material={TANK_MATERIALS.rail} />
            </group>
          ))}
          {compartments.map((c) => {
            const cx = (c.fromX + c.toX) / 2;
            return (
              <group key={c.id}>
                <CCyl centre={[cx, w / 2, top + 0.05]} radius={0.27} length={0.1} axis={2} material={TANK_MATERIALS.ring} />
                <FloorRect minX={cx - 0.21} maxX={cx + 0.21} minY={w / 2 - 0.105} maxY={w / 2 + 0.105} z={top + 0.103} material={labelMaterial(c.label, '#1d1d1b', 2)} />
              </group>
            );
          })}
        </group>
      )}
      {/* rear ladder */}
      {[w / 2 - 0.22, w / 2 + 0.19].map((y) => (
        <CBox key={y} min={[x1 + head + 0.04, y, -vehicle.deckHeight + 0.45]} max={[x1 + head + 0.07, y + 0.03, h + 0.35]} material={TANK_MATERIALS.rail} />
      ))}
      {Array.from({ length: Math.max(3, Math.floor((h + vehicle.deckHeight - 0.2) / 0.3)) }, (_, i) => -vehicle.deckHeight + 0.6 + i * 0.3)
        .filter((z) => z < h + 0.3)
        .map((z) => (
          <CBox key={z} min={[x1 + head + 0.04, w / 2 - 0.2, z]} max={[x1 + head + 0.07, w / 2 + 0.2, z + 0.025]} material={TANK_MATERIALS.rail} />
        ))}
      {/* hose cabinet and bottom valves */}
      <CBox min={[l * 0.32, -0.04, -0.78]} max={[l * 0.56, 0.42, -0.2]} material={TANK_MATERIALS.cabinet} />
      <CBox min={[l * 0.32 + 0.04, -0.05, -0.74]} max={[l * 0.56 - 0.04, -0.04, -0.24]} material={MATERIALS.chassis} />
      {compartments.map((c) => {
        const cx = (c.fromX + c.toX) / 2;
        return (
          <group key={`v-${c.id}`}>
            <CCyl centre={[cx, w / 2, -0.12]} radius={0.06} length={0.2} axis={2} material={MATERIALS.steel} />
            <CCyl centre={[cx, w / 2 - 0.45, -0.2]} radius={0.04} length={0.9} axis={1} material={MATERIALS.steel} />
            <CBox min={[cx - 0.05, 0.02, -0.26]} max={[cx + 0.05, 0.06, -0.14]} material={TANK_MATERIALS.valveRed} />
          </group>
        );
      })}
    </group>
  );
});
