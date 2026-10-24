import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LineBasicMaterial, SphereGeometry, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { isBulk } from '../domain/geometry';
import { materialColor, maxFillPct } from '../domain/materials';
import type { ItemSpec } from '../domain/types';
import { formatLength, formatMaterialDensity, formatLitres, formatMass } from '../domain/units';
import { useUnitSystem } from '../state/hooks';
import { toThree, vecToThree } from './coords';
import { LabelContext, LabelLayer, LabelProjector, LabelStore, SceneLabel } from './labels';
import { Lighting } from './Lighting';
import { COG_OVERLAY, LINE_MATERIALS, MATERIALS } from './materials';
import { CLines, FloorRect } from './prims';
import { LiquidBody } from './TankLayer';
import { TANK_MATERIALS, X_BAND, X_CYLINDER } from './TankModel';
import { UnitMesh } from './UnitMesh';

const FOV = 32;
const DIM_LINE = new LineBasicMaterial({ color: '#77756e' });
const COG_SPHERE = new SphereGeometry(1, 20, 14);
const VIEW_DIR = new Vector3(1.25, 0.9, 1.45).normalize();
const LABEL = 'num w-max -translate-x-1/2 -translate-y-1/2 rounded bg-card/90 px-1 font-mono text-[10px] font-semibold text-ink-soft shadow-sm';
/** Tag colour of the realistic model when the item has no colour of its own (accent). */
const PREVIEW_TAG = '#f59e0b';

/** Small orbitable 3D preview of one item with L/W/H dimension callouts and its centre-of-gravity marker. */
export function ItemPreview({ spec, className = '' }: { spec: ItemSpec; className?: string }) {
  const [labels] = useState(() => new LabelStore());
  return (
    <div className={`relative overflow-hidden rounded-card border border-line bg-canvas ${className}`} aria-label={`3D preview of ${spec.name}`}>
      <LabelContext.Provider value={labels}>
        <Canvas
          shadows="percentage"
          frameloop="demand"
          dpr={[1, 2]}
          camera={{ fov: FOV, near: 0.01, far: 200, position: [3, 2, 3] }}
          onCreated={({ gl }) => {
            gl.localClippingEnabled = true;
          }}
        >
          <color attach="background" args={['#f4f4f1']} />
          {isBulk(spec) ? <BulkPreview spec={spec} /> : <PreviewContent spec={spec} />}
          <LabelProjector store={labels} />
        </Canvas>
        <LabelLayer store={labels} />
      </LabelContext.Provider>
    </div>
  );
}

/** Section of a tank compartment, length × width × height (m), shown for bulk liquid fills. */
const SECTION = { l: 1.6, w: 2.4, h: 1.8 };

/** Bulk fill: a short tank section filled to the liquid's safe maximum, with volume, weight and density. */
function BulkPreview({ spec }: { spec: ItemSpec }) {
  const units = useUnitSystem();
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const { l, w, h } = SECTION;
  const liquid = spec.material;
  useLayoutEffect(() => {
    const target = vecToThree({ x: l / 2, y: w / 2, z: h / 2 });
    camera.position.copy(target).addScaledVector(VIEW_DIR, (Math.hypot(l, w, h) / 2 / Math.sin(((FOV / 2) * Math.PI) / 180)) * 1.1);
    camera.lookAt(target);
    controls.current?.target.copy(target);
    controls.current?.update();
    invalidate();
  }, [camera, invalidate, l, w, h]);
  return (
    <>
      <Lighting centre={toThree(l / 2, w / 2, 0)} radius={3} sunIntensity={2} />
      <FloorRect minX={-0.6} maxX={l + 0.6} minY={-0.4} maxY={w + 0.4} z={-0.002} material={MATERIALS.ground} />
      <mesh geometry={X_CYLINDER} material={TANK_MATERIALS.shell} position={toThree(l / 2, w / 2, h / 2)} scale={[l, h, w]} />
      {[0, l].map((x) => (
        <mesh key={x} geometry={X_BAND} material={TANK_MATERIALS.ring} position={toThree(x, w / 2, h / 2)} scale={[0.05, h * 1.015, w * 1.015]} />
      ))}
      <LiquidBody fromX={0.02} toX={l - 0.02} width={w} height={h} frontHead={0} rearHead={0} color={materialColor(liquid?.materialId ?? 'custom')} fill={maxFillPct(liquid?.materialId ?? 'custom', 'liquid') / 100} />
      <SceneLabel position={toThree(l / 2, w / 2, h + 0.2)}>
        <div className="num w-max -translate-x-1/2 -translate-y-full rounded bg-card/90 px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold text-ink-soft shadow-sm">
          {formatLitres(liquid?.volumeL ?? 0, units, (liquid?.volumeL ?? 0) >= 100 ? 0 : 1)} · {formatMass(spec.weightKg, units)}
          {liquid && <div className="font-normal text-muted">{formatMaterialDensity(liquid.densityKgPerL, liquid.state, units)}</div>}
        </div>
      </SceneLabel>
      <OrbitControls ref={controls} enablePan={false} enableDamping={false} minDistance={1.5} maxDistance={14} />
    </>
  );
}

function PreviewContent({ spec }: { spec: ItemSpec }) {
  const units = useUnitSystem();
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const { l, w, h } = spec.dims;
  // Item-local axes (l along x, w along y, h up), centred on the footprint.
  const box = useMemo(() => ({ min: { x: -l / 2, y: -w / 2, z: 0 }, max: { x: l / 2, y: w / 2, z: h } }), [l, w, h]);
  const size = Math.max(l, w, h, 0.05);
  const tick = size * 0.06;
  const gap = size * 0.08;

  // Auto-fit whenever the dimensions change.
  useLayoutEffect(() => {
    const target = vecToThree({ x: 0, y: 0, z: h / 2 });
    const radius = Math.hypot(l, w, h) / 2 + gap * 2;
    camera.position.copy(target).addScaledVector(VIEW_DIR, (radius / Math.sin(((FOV / 2) * Math.PI) / 180)) * 1.05);
    camera.lookAt(target);
    controls.current?.target.copy(target);
    controls.current?.update();
    invalidate();
  }, [camera, invalidate, l, w, h, gap]);

  const dims = useMemo(() => {
    const y0 = -w / 2 - gap;
    const x0 = l / 2 + gap;
    return {
      length: [-l / 2, y0, 0, l / 2, y0, 0, -l / 2, y0 - tick, 0, -l / 2, y0 + tick, 0, l / 2, y0 - tick, 0, l / 2, y0 + tick, 0],
      width: [x0, -w / 2, 0, x0, w / 2, 0, x0 - tick, -w / 2, 0, x0 + tick, -w / 2, 0, x0 - tick, w / 2, 0, x0 + tick, w / 2, 0],
      height: [x0, y0, 0, x0, y0, h, x0 - tick, y0, h, x0 + tick, y0, h],
      labels: {
        length: toThree(0, y0 - tick * 2.5, 0),
        width: toThree(x0 + tick * 2.5, 0, 0),
        height: toThree(x0 + tick * 2.5, y0, h / 2),
      },
    };
  }, [l, w, h, gap, tick]);

  const { x: cx, y: cy, z: cz } = spec.cogOffset;
  const cogLine = useMemo(() => [cx, cy, 0, cx, cy, h + gap], [cx, cy, h, gap]);

  return (
    <>
      <Lighting centre={[0, h / 2, 0]} radius={size * 1.6} sunIntensity={2} />
      <FloorRect minX={-l / 2 - gap * 3} maxX={l / 2 + gap * 3} minY={-w / 2 - gap * 3} maxY={w / 2 + gap * 3} z={-0.002} material={MATERIALS.ground} />
      <UnitMesh spec={spec} orient={0} box={box} color={spec.color ?? PREVIEW_TAG} realistic />
      <CLines points={dims.length} material={DIM_LINE} />
      <CLines points={dims.width} material={DIM_LINE} />
      <CLines points={dims.height} material={DIM_LINE} />
      <CLines points={cogLine} material={LINE_MATERIALS.cog} />
      <mesh geometry={COG_SPHERE} material={COG_OVERLAY} position={toThree(cx, cy, h / 2 + cz)} scale={Math.max(0.025, size * 0.035)} renderOrder={10} />
      <SceneLabel position={dims.labels.length}>
        <div className={LABEL}>L {formatLength(l, units)}</div>
      </SceneLabel>
      <SceneLabel position={dims.labels.width}>
        <div className={LABEL}>W {formatLength(w, units)}</div>
      </SceneLabel>
      <SceneLabel position={dims.labels.height}>
        <div className={LABEL}>H {formatLength(h, units)}</div>
      </SceneLabel>
      <OrbitControls ref={controls} enablePan={false} enableDamping={false} minDistance={size * 0.6} maxDistance={size * 8} />
    </>
  );
}
