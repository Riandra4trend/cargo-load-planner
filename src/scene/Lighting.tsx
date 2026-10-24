import { Environment, Lightformer } from '@react-three/drei';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Object3D, type DirectionalLight } from 'three';

const SUN_DISTANCE = 40;

/**
 * Studio-style lighting built from local light formers (no downloaded HDRIs): soft image-based
 * ambient for reflections and shading, plus a shadow-casting sun aimed at `centre` (three.js
 * coordinates) whose shadow camera covers a square of half-size `radius`.
 */
export function Lighting({ centre, radius, sunIntensity = 1.9 }: { centre: readonly [number, number, number]; radius: number; sunIntensity?: number }) {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const [cx, cy, cz] = centre;
  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    target.position.set(cx, cy, cz);
    target.updateMatrixWorld();
    l.target = target;
    l.position.set(cx - SUN_DISTANCE * 0.42, cy + SUN_DISTANCE, cz + SUN_DISTANCE * 0.5);
    const cam = l.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 1;
    cam.far = SUN_DISTANCE * 2.6;
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }, [cx, cy, cz, radius, target]);
  return (
    <>
      <ambientLight intensity={0.12} />
      <hemisphereLight args={['#ffffff', '#b9b2a2', 0.35]} />
      <directionalLight ref={light} castShadow intensity={sunIntensity} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.025} shadow-radius={5} />
      <directionalLight position={[cx + 25, cy + 12, cz - 20]} intensity={0.35} />
      <Environment resolution={128} frames={1} environmentIntensity={0.55}>
        <color attach="background" args={['#bdb9b0']} />
        <Lightformer form="rect" intensity={2} position={[0, 14, 0]} rotation-x={Math.PI / 2} scale={[40, 40, 1]} />
        <Lightformer form="rect" intensity={0.9} position={[-18, 6, 12]} scale={[24, 8, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.5} position={[18, 5, -12]} scale={[24, 8, 1]} target={[0, 0, 0]} />
      </Environment>
    </>
  );
}
