import type { RefObject } from 'react';
import type { Group } from 'three';
import { MATERIALS, WHEEL_CYLINDER } from './materials';
import { CBox, CCyl } from './prims';

/**
 * Counterbalance forklift from primitives. Local cargo axes with the origin at the fork heel on the
 * floor; the forks point toward -x (into the vehicle). `carriageRef` moves the fork carriage up.
 */
export function Forklift({ rootRef, carriageRef }: { rootRef: RefObject<Group | null>; carriageRef: RefObject<Group | null> }) {
  return (
    <group ref={rootRef}>
      {/* mast */}
      {[-0.42, 0.36].map((y) => (
        <CBox key={y} min={[0.05, y, 0.05]} max={[0.13, y + 0.06, 2.15]} material={MATERIALS.forkliftDark} />
      ))}
      <CBox min={[0.05, -0.42, 2.08]} max={[0.13, 0.42, 2.15]} material={MATERIALS.forkliftDark} />
      {/* carriage: backrest + forks */}
      <group ref={carriageRef}>
        <CBox min={[-0.03, -0.45, 0]} max={[0.04, 0.45, 0.08]} material={MATERIALS.forks} />
        <CBox min={[-0.03, -0.45, 0.6]} max={[0.04, 0.45, 0.68]} material={MATERIALS.forks} />
        {[-0.4, 0.33].map((y) => (
          <CBox key={y} min={[-0.03, y, 0]} max={[0.04, y + 0.07, 0.68]} material={MATERIALS.forks} />
        ))}
        {[-0.32, 0.22].map((y) => (
          <CBox key={y} min={[-1.1, y, 0]} max={[0.0, y + 0.1, 0.045]} material={MATERIALS.forks} />
        ))}
      </group>
      {/* body, counterweight, seat */}
      <CBox min={[0.15, -0.55, 0.22]} max={[1.55, 0.55, 1.02]} material={MATERIALS.forklift} />
      <CBox min={[1.45, -0.55, 0.22]} max={[1.95, 0.55, 1.2]} material={MATERIALS.forkliftDark} />
      <CBox min={[1.0, -0.25, 1.02]} max={[1.35, 0.25, 1.12]} material={MATERIALS.forkliftDark} />
      <CBox min={[1.28, -0.25, 1.1]} max={[1.36, 0.25, 1.55]} material={MATERIALS.forkliftDark} />
      {/* overhead guard */}
      {[0.45, 1.48].flatMap((x) =>
        [-0.52, 0.48].map((y) => <CBox key={`${x}:${y}`} min={[x, y, 1.02]} max={[x + 0.05, y + 0.04, 2.1]} material={MATERIALS.forkliftDark} />),
      )}
      <CBox min={[0.42, -0.55, 2.05]} max={[1.56, 0.55, 2.1]} material={MATERIALS.forklift} />
      {/* wheels */}
      {[
        [0.42, 0.26],
        [1.62, 0.21],
      ].flatMap(([x, r]) =>
        [-0.48, 0.48].map((y) => <CCyl key={`${x}:${y}`} centre={[x, y, r]} radius={r} length={0.2} axis={1} material={MATERIALS.tyre} geometry={WHEEL_CYLINDER} />),
      )}
    </group>
  );
}
