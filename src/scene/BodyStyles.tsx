import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Object3D, type Group, type InstancedMesh, type Material } from 'three';
import type { Vehicle } from '../domain/types';
import { toThree } from './coords';
import { MATERIALS, UNIT_BOX } from './materials';
import { CBox, CLines } from './prims';
import type { VehicleLayout } from './vehicleLayout';

/** Opening angle of the wingbox panels when raised, radians. */
const WING_OPEN = 1.25;

/** Box in a wing's local three.js frame (origin on the ridge hinge): X along the body, Y up, Z across. */
function LocalBox({ x0, x1, y0, y1, z0, z1, material }: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; material: Material }) {
  return <mesh geometry={UNIT_BOX} material={material} position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]} scale={[x1 - x0, y1 - y0, z1 - z0]} castShadow={!material.transparent} />;
}

/**
 * Wingbox sides: each side wall plus its half of the roof forms a gull-wing panel hinged on the roof
 * ridge; both wings swing up (animated) when `open`.
 */
export function WingSides({ vehicle, open }: { vehicle: Vehicle; open: boolean }) {
  const { l, w, h } = vehicle.cargo;
  const left = useRef<Group>(null);
  const right = useRef<Group>(null);
  const angle = useRef(open ? WING_OPEN : 0);
  useFrame((_, delta) => {
    const target = open ? WING_OPEN : 0;
    if (Math.abs(angle.current - target) < 1e-3) return;
    angle.current += Math.sign(target - angle.current) * Math.min(Math.abs(target - angle.current), delta * 1.6);
    if (left.current) left.current.rotation.x = -angle.current;
    if (right.current) right.current.rotation.x = angle.current;
  });
  useLayoutEffect(() => {
    if (left.current) left.current.rotation.x = -angle.current;
    if (right.current) right.current.rotation.x = angle.current;
  }, []);
  const half = w / 2 + 0.04;
  const wing = (side: 1 | -1) => (
    <>
      <LocalBox x0={-l / 2} x1={l / 2} y0={-0.06} y1={0} z0={side > 0 ? 0 : -half} z1={side > 0 ? half : 0} material={MATERIALS.roof} />
      <LocalBox x0={-l / 2} x1={l / 2} y0={-(h + 0.06)} y1={-0.06} z0={side > 0 ? half - 0.04 : -half} z1={side > 0 ? half : -half + 0.04} material={MATERIALS.wall} />
      {/* panel frame: bottom rail and end posts */}
      <LocalBox x0={-l / 2} x1={l / 2} y0={-(h + 0.06)} y1={-(h - 0.02)} z0={side > 0 ? half - 0.05 : -half} z1={side > 0 ? half + 0.01 : -half + 0.05} material={MATERIALS.doorFrame} />
      {[-l / 2, l / 2 - 0.06].map((x) => (
        <LocalBox key={x} x0={x} x1={x + 0.06} y0={-(h + 0.06)} y1={0} z0={side > 0 ? half - 0.05 : -half} z1={side > 0 ? half + 0.01 : -half + 0.05} material={MATERIALS.doorFrame} />
      ))}
    </>
  );
  const ridge = toThree(l / 2, w / 2, h + 0.06);
  return (
    <group>
      <group ref={left} position={ridge}>
        {wing(1)}
      </group>
      <group ref={right} position={ridge}>
        {wing(-1)}
      </group>
      {/* roof ridge / hinge line */}
      <CBox min={[0, w / 2 - 0.05, h + 0.06]} max={[l, w / 2 + 0.05, h + 0.12]} material={MATERIALS.doorFrame} />
    </group>
  );
}

const BUCKLE_PITCH = 0.55;

/** Curtainsider sides: translucent fabric curtains with pleats, a top rail and strap buckles along the bottom. */
export function CurtainSides({ vehicle }: { vehicle: Vehicle }) {
  const { l, w, h } = vehicle.cargo;
  const buckles = useRef<InstancedMesh>(null);
  const perSide = Math.max(2, Math.floor(l / BUCKLE_PITCH));
  const pleats = useMemo(() => {
    const pts: number[] = [];
    for (let x = 0.45; x < l; x += 0.45) for (const y of [-0.045, w + 0.045]) pts.push(x, y, 0.05, x, y, h - 0.05);
    return pts;
  }, [l, w, h]);
  useLayoutEffect(() => {
    const mesh = buckles.current;
    if (!mesh) return;
    const o = new Object3D();
    let i = 0;
    for (let k = 0; k < perSide; k++) {
      const x = (k + 0.5) * (l / perSide);
      for (const y of [-0.055, w + 0.055]) {
        o.position.set(...toThree(x, y, 0.12));
        o.scale.set(0.05, 0.16, 0.02);
        o.updateMatrix();
        mesh.setMatrixAt(i++, o.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [l, w, perSide]);
  return (
    <group>
      <CBox min={[0, -0.05, 0]} max={[l, -0.03, h]} material={MATERIALS.curtain} />
      <CBox min={[0, w + 0.03, 0]} max={[l, w + 0.05, h]} material={MATERIALS.curtain} />
      <CLines points={pleats} />
      {[-0.07, w + 0.03].map((y) => (
        <CBox key={y} min={[0, y, h - 0.06]} max={[l, y + 0.04, h]} material={MATERIALS.doorFrame} />
      ))}
      <instancedMesh ref={buckles} args={[UNIT_BOX, MATERIALS.chassis, perSide * 2]} />
    </group>
  );
}

/** Open dropside bed (pick-ups, light trucks): deck, ~0.4 m drop sides, tailgate and a cab-protector headboard. */
export function DropsideBed({ vehicle }: { vehicle: Vehicle }) {
  const { l, w, h } = vehicle.cargo;
  const side = Math.min(0.4, h);
  const head = Math.min(h, side + 0.45);
  return (
    <group>
      <CBox min={[0, 0, -0.12]} max={[l, w, 0]} material={MATERIALS.deck} />
      <CBox min={[0, -0.04, 0]} max={[l, 0, side]} material={MATERIALS.dropside} />
      <CBox min={[0, w, 0]} max={[l, w + 0.04, side]} material={MATERIALS.dropside} />
      <CBox min={[l, -0.04, 0]} max={[l + 0.04, w + 0.04, side]} material={MATERIALS.dropside} />
      <CBox min={[-0.05, -0.04, 0]} max={[0, w + 0.04, side]} material={MATERIALS.dropside} />
      {/* headboard rack over the cab */}
      {[0.02, w - 0.06].map((y) => (
        <CBox key={y} min={[-0.05, y, side]} max={[-0.01, y + 0.04, head]} material={MATERIALS.steel} />
      ))}
      {[0.6, 1].map((f) => (
        <CBox key={f} min={[-0.05, 0.02, side + (head - side) * f - 0.04]} max={[-0.01, w - 0.02, side + (head - side) * f]} material={MATERIALS.steel} />
      ))}
      {/* side hinges and latch posts */}
      {[0.25, 0.5, 0.75].map((f) => (
        <group key={f}>
          <CBox min={[l * f - 0.03, -0.06, 0.02]} max={[l * f + 0.03, -0.04, side - 0.02]} material={MATERIALS.steel} />
          <CBox min={[l * f - 0.03, w + 0.04, 0.02]} max={[l * f + 0.03, w + 0.06, side - 0.02]} material={MATERIALS.steel} />
        </group>
      ))}
    </group>
  );
}

/** Mudguards over the driven / rear axles (dump trucks). */
export function Mudguards({ vehicle, layout }: { vehicle: Vehicle; layout: VehicleLayout }) {
  const { w } = vehicle.cargo;
  const r = layout.wheelRadius;
  const top = -vehicle.deckHeight + r * 2 + 0.06;
  const rear = layout.axles.filter((a) => a.groupIndex > 0);
  if (!rear.length) return null;
  const from = Math.min(...rear.map((a) => a.x)) - r - 0.12;
  const to = Math.max(...rear.map((a) => a.x)) + r + 0.12;
  return (
    <group>
      {[-0.04, w - 0.62].map((y) => (
        <group key={y}>
          <CBox min={[from, y, top]} max={[to, y + 0.66, top + 0.04]} material={MATERIALS.mudguard} />
          <CBox min={[to - 0.03, y, top - r * 1.1]} max={[to, y + 0.66, top]} material={MATERIALS.mudguard} />
        </group>
      ))}
    </group>
  );
}
