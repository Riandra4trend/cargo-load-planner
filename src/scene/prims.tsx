import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, type Material } from 'three';
import { boxProps, toThree, writeThree, yToCargoAxisRotation, type CargoAxis } from './coords';
import { LINE_MATERIALS, UNIT_BOX, UNIT_CYLINDER, UNIT_PLANE } from './materials';

type Triple = readonly [number, number, number];

/** Axis-aligned box given by cargo-space min / max corners. Opaque boxes cast and receive shadows. */
export function CBox({ min, max, material }: { min: Triple; max: Triple; material: Material }) {
  const { position, scale } = boxProps(min, max);
  return <mesh geometry={UNIT_BOX} material={material} position={position} scale={scale} castShadow={!material.transparent} receiveShadow />;
}

/** Cylinder centred at a cargo point, running along a cargo axis. */
export function CCyl({ centre, radius, length, axis, material, geometry = UNIT_CYLINDER }: { centre: Triple; radius: number; length: number; axis: CargoAxis; material: Material; geometry?: BufferGeometry }) {
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={toThree(centre[0], centre[1], centre[2])}
      rotation={yToCargoAxisRotation(axis)}
      scale={[radius * 2, length, radius * 2]}
      castShadow={!material.transparent}
      receiveShadow
    />
  );
}

/** Flat rectangle on a horizontal cargo plane (z = const), e.g. floor strips and painted labels. */
export function FloorRect({ minX, maxX, minY, maxY, z, material }: { minX: number; maxX: number; minY: number; maxY: number; z: number; material: Material }) {
  return (
    <mesh
      geometry={UNIT_PLANE}
      material={material}
      position={toThree((minX + maxX) / 2, (minY + maxY) / 2, z)}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[maxX - minX, maxY - minY, 1]}
      receiveShadow
    />
  );
}

/** Line segments from a flat list of cargo-space points (pairs). */
export function CLines({ points, material = LINE_MATERIALS.frame }: { points: readonly number[]; material?: Material }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const arr = new Float32Array(points.length);
    for (let i = 0; i < points.length; i += 3) writeThree(arr, i, points[i], points[i + 1], points[i + 2]);
    g.setAttribute('position', new BufferAttribute(arr, 3));
    return g;
  }, [points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineSegments geometry={geometry} material={material} />;
}

/** Flat list of the 12 edges of a cargo-space box (24 points). */
export function boxEdgePoints(min: Triple, max: Triple): number[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  return e.flatMap((i) => c[i]);
}
