import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Color, MeshStandardMaterial, SphereGeometry, type Group, type Mesh } from 'three';
import { heatColor } from '../domain/colors';
import type { Customer, Stop, UnitSystem, Vehicle } from '../domain/types';
import { materialColor } from '../domain/materials';
import { formatMass, formatMaterialDensity, formatMaterialVolume, formatPercent } from '../domain/units';
import { maxLegalFill, type MassPoint } from '../physics';
import type { LoadStep } from '../sim/sequence';
import { useStore } from '../state/store';
import type { CargoHighlights } from './CargoLayer';
import { dropInProgress, RISE_MS } from './dropIn';
import { setThree, toThree } from './coords';
import { SceneLabel } from './labels';
import { MATERIALS, UNIT_BOX, UNIT_CYLINDER } from './materials';
import { unitColor, type ColorContext } from './palette';
import { CBox } from './prims';
import { UNLOAD_STEP_S } from './Simulation';
import type { TankFill } from './TankLayer';
import { grainTexture } from './textures';
import { heapShape, tipTimeline, type HeapShape } from './tipperMath';
import { vehicleLayout } from './vehicleLayout';

const FILL_STEP_S = 2.4;
const BODY_COLORS = ['#f2b705', '#c92a2a', '#1f5fbf'];
const SIDE = 0.07;
/** Hydraulic ram: chassis mount and body attachment (body frame, untipped), cargo x / z. */
const RAM_BASE = { x: -0.3, z: -0.55 };
const RAM_TOP = { x: 0.2, z: -0.1 };
/** Top half of a sphere (dome), radius 0.5, flat side down at y = 0. */
const DOME = new SphereGeometry(0.5, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const PICK = new MeshStandardMaterial({ visible: false });
const OUTLINE = {
  selected: new MeshStandardMaterial({ color: '#f59e0b', emissive: '#f59e0b', emissiveIntensity: 0.4 }),
  hover: new MeshStandardMaterial({ color: '#1d1d1b' }),
  axle: new MeshStandardMaterial({ color: '#2563eb', emissive: '#2563eb', emissiveIntensity: 0.3 }),
};

export interface TipperLayerProps {
  vehicle: Vehicle;
  /** The body's fill (a tipper has one compartment). */
  fill: TankFill | null;
  /** Mass points of the other cargo (for the legal maximum). */
  points: MassPoint[];
  colors: ColorContext;
  highlights: CargoHighlights;
  stops: Stop[];
  customers: Customer[];
  units: UnitSystem;
  animMode: 'idle' | 'load' | 'unload';
  step: number;
  playing: boolean;
  speed: number;
  sequence: LoadStep[];
  unloadFrom: number;
  interactive: boolean;
}

/**
 * Dump truck body with its material heap: steel body with ribbed sides, cab-protector headboard,
 * top-hinged tailgate and hydraulic ram. Loading pours the heap from a hopper; unloading tips the
 * body about the rear hinge while the material slides out onto a pile behind the truck.
 */
export const TipperLayer = memo(function TipperLayer(props: TipperLayerProps) {
  const { vehicle, fill, colors, highlights, animMode, step, playing, speed, sequence, unloadFrom, interactive } = props;
  const { l, w, h } = vehicle.cargo;
  const layout = useMemo(() => vehicleLayout(vehicle), [vehicle]);
  const hingeX = l + 0.02;
  const hingeZ = -0.16;
  const bodyMat = useMemo(() => {
    let hash = 0;
    for (const ch of vehicle.id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return new MeshStandardMaterial({ color: BODY_COLORS[Math.abs(hash) % BODY_COLORS.length], roughness: 0.55, metalness: 0.25 });
  }, [vehicle.id]);
  useEffect(() => () => bodyMat.dispose(), [bodyMat]);

  const material = fill?.unit.spec.material;
  const heapColor = colors.mode === 'weight' && fill ? heatColor(colors.maxKg > 0 ? fill.unit.spec.weightKg / colors.maxKg : 0) : materialColor(material?.materialId ?? 'custom', 'solid');
  const heapMat = useMemo(() => new MeshStandardMaterial({ color: new Color(heapColor), map: grainTexture(), roughness: 0.95, metalness: 0 }), [heapColor]);
  useEffect(() => () => heapMat.dispose(), [heapMat]);

  const pivot = useRef<Group>(null);
  const tailgate = useRef<Group>(null);
  const heapBody = useRef<Mesh>(null);
  const heapDome = useRef<Mesh>(null);
  const pile = useRef<Mesh>(null);
  const ram = useRef<Mesh>(null);
  const stream = useRef<Mesh>(null);
  const shape = useRef<HeapShape>({ level: 0, mound: 0, moundL: 0, moundW: 0 });

  const fillStep = animMode === 'load' && fill && sequence[step]?.unitId === fill.unit.id;
  const fillIndex = fill ? sequence.findIndex((s) => s.unitId === fill.unit.id) : -1;
  const progress = useRef(0);
  const elapsed = useRef(0);
  const advanced = useRef(false);
  useLayoutEffect(() => {
    progress.current = 0;
    elapsed.current = 0;
    advanced.current = false;
  }, [step, animMode]);

  const il = l - 0.02;
  const iw = w - 0.02;
  useFrame((_, delta) => {
    // Idle: a freshly added fill rises into the body.
    let current = fill ? fill.fill * dropInProgress(fill.unit.id, performance.now(), RISE_MS) : 0;
    let angle = 0;
    let out = 0;
    if (animMode === 'load' && fill) {
      if (fillStep && playing) {
        progress.current = Math.min(1, progress.current + (delta * speed) / FILL_STEP_S);
        if (progress.current >= 1 && !advanced.current) {
          advanced.current = true;
          useStore.getState().setAnimation(step + 1 >= sequence.length ? { step: step + 1, playing: false } : { step: step + 1 });
        }
      }
      current = fillIndex < step ? fill.fill : fillStep ? fill.fill * progress.current : 0;
    } else if (animMode === 'unload' && fill) {
      elapsed.current += delta * speed;
      const seq = fill.unit.stopSeq;
      if (seq <= unloadFrom) current = 0;
      else if (seq <= step) {
        const tl = tipTimeline(elapsed.current / UNLOAD_STEP_S);
        angle = tl.angle;
        out = tl.out;
        current = fill.fill * (1 - out);
      }
      if (seq <= unloadFrom) out = 1;
    }
    if (pivot.current) pivot.current.rotation.z = -angle;
    if (tailgate.current) tailgate.current.rotation.z = angle * 0.95;
    const s = heapShape(current, il, iw, h, shape.current);
    const b = heapBody.current;
    if (b) {
      b.visible = s.level > 0.002;
      setThree(b.position, l / 2, w / 2, s.level / 2);
      b.scale.set(il, Math.max(0.001, s.level), iw);
    }
    const d = heapDome.current;
    if (d) {
      d.visible = s.mound > 0.002;
      setThree(d.position, l / 2, w / 2, s.level);
      d.scale.set(il * s.moundL, s.mound * 2, iw * s.moundW);
    }
    const p = pile.current;
    if (p) {
      const vol = (fill?.fill ?? 0) * il * iw * h * (animMode === 'unload' ? out : 0);
      p.visible = vol > 0.001;
      // Cone-ish pile: half ellipsoid with radius r and height 0.45 r holds 2/3 π r² · 0.45 r.
      const r = Math.cbrt(vol / ((2 / 3) * Math.PI * 0.45));
      setThree(p.position, hingeX + 0.4 + r * 0.8, w / 2, -vehicle.deckHeight);
      p.scale.set(r * 2, r * 0.9, r * 2 * 0.9);
    }
    const rm = ram.current;
    if (rm) {
      // Ram from its chassis mount to the body's front underside, which tips with the body (see tipPoint).
      const rx = RAM_TOP.x - hingeX;
      const rz = RAM_TOP.z - hingeZ;
      const topX = hingeX + rx * Math.cos(angle) + rz * Math.sin(angle);
      const topZ = hingeZ - rx * Math.sin(angle) + rz * Math.cos(angle);
      const dx = topX - RAM_BASE.x;
      const dz = topZ - RAM_BASE.z;
      setThree(rm.position, (RAM_BASE.x + topX) / 2, w / 2, (RAM_BASE.z + topZ) / 2);
      rm.rotation.z = -Math.atan2(dx, dz);
      rm.scale.set(0.12, Math.hypot(dx, dz), 0.12);
    }
    const st = stream.current;
    if (st) {
      const pouring = !!fillStep && progress.current < 1;
      st.visible = pouring;
      if (pouring) {
        const topZ = h + 2.1;
        setThree(st.position, l / 2, w / 2, (topZ + s.level + s.mound) / 2);
        st.scale.set(0.22, Math.max(0.01, topZ - s.level - s.mound), 0.3);
      }
    }
  });

  // ---- interaction ----
  const [hovered, setHovered] = useState(false);
  const setHover = useStore((s) => s.setHover);
  const select = useStore((s) => s.select);
  useEffect(() => {
    if (!interactive) setHovered(false);
  }, [interactive]);
  const unitId = fill?.unit.id;
  const outline = unitId && highlights.selected.has(unitId) ? OUTLINE.selected : hovered || (unitId && highlights.hover === unitId) ? OUTLINE.hover : unitId && highlights.axle.has(unitId) ? OUTLINE.axle : null;
  const railMat = outline ?? bodyMat;

  const ribs = useMemo(() => {
    const n = Math.max(2, Math.round(l / 0.6));
    return Array.from({ length: n - 1 }, (_, i) => ((i + 1) * l) / n);
  }, [l]);
  const canopyZ = Math.max(h + 0.35, layout.cab.topZ + 0.06);

  return (
    <group>
      <group ref={pivot} position={toThree(hingeX, 0, hingeZ)}>
        <group position={toThree(-hingeX, 0, -hingeZ)}>
          {/* floor, sides with ribs and top rails, headboard with cab protector */}
          <CBox min={[-0.08, -SIDE, -0.12]} max={[l, w + SIDE, 0]} material={bodyMat} />
          <CBox min={[0, -SIDE, 0]} max={[l, 0, h]} material={bodyMat} />
          <CBox min={[0, w, 0]} max={[l, w + SIDE, h]} material={bodyMat} />
          <CBox min={[-0.02, -SIDE - 0.03, h - 0.06]} max={[l, 0.01, h + 0.02]} material={railMat} />
          <CBox min={[-0.02, w - 0.01, h - 0.06]} max={[l, w + SIDE + 0.03, h + 0.02]} material={railMat} />
          {ribs.map((x) => (
            <group key={x}>
              <CBox min={[x - 0.03, -SIDE - 0.04, 0]} max={[x + 0.03, -SIDE, h - 0.06]} material={bodyMat} />
              <CBox min={[x - 0.03, w + SIDE, 0]} max={[x + 0.03, w + SIDE + 0.04, h - 0.06]} material={bodyMat} />
            </group>
          ))}
          <CBox min={[-0.1, -SIDE, 0]} max={[0, w + SIDE, canopyZ]} material={bodyMat} />
          <CBox min={[layout.cab.toX - 0.55, -SIDE, canopyZ - 0.06]} max={[0, w + SIDE, canopyZ]} material={bodyMat} />
          {/* top-hinged tailgate */}
          <group ref={tailgate} position={toThree(l + 0.03, 0, h)}>
            <group position={toThree(-(l + 0.03), 0, -h)}>
              <CBox min={[l, -SIDE, 0.02]} max={[l + 0.06, w + SIDE, h]} material={bodyMat} />
              <CBox min={[l + 0.06, 0.15, h * 0.35]} max={[l + 0.09, w - 0.15, h * 0.45]} material={MATERIALS.chassis} />
            </group>
          </group>
          {/* material heap */}
          <mesh ref={heapBody} geometry={UNIT_BOX} material={heapMat} castShadow receiveShadow visible={false} />
          <mesh ref={heapDome} geometry={DOME} material={heapMat} castShadow receiveShadow visible={false} />
          <mesh
            geometry={UNIT_BOX}
            material={PICK}
            position={toThree(l / 2, w / 2, h / 2)}
            scale={[l, h, w]}
            onPointerMove={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (!interactive || hovered) return;
              setHovered(true);
              setHover(unitId ?? null);
            }}
            onPointerOut={() => {
              if (!hovered) return;
              setHovered(false);
              setHover(null);
            }}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              if (e.button !== 0 || !interactive) return;
              e.stopPropagation();
              const additive = e.nativeEvent.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey;
              if (unitId) select([unitId], additive ? 'toggle' : 'replace');
              else if (!additive) select([]);
            }}
          />
        </group>
      </group>
      {/* hydraulic ram (front of the body), stop-colour band on the headboard */}
      <mesh ref={ram} geometry={UNIT_CYLINDER} material={MATERIALS.hydraulic} castShadow />
      {fill && <CBox min={[-0.115, 0.1, h * 0.25]} max={[-0.1, w - 0.1, h * 0.55]} material={bandMaterial(unitColor(fill.unit, colors))} />}
      <mesh ref={pile} geometry={DOME} material={heapMat} castShadow receiveShadow visible={false} />
      {/* hopper pouring the load */}
      {fillStep && (
        <group>
          <CBox min={[l / 2 - 0.6, w / 2 - 0.6, h + 2.1]} max={[l / 2 + 0.6, w / 2 + 0.6, h + 2.9]} material={MATERIALS.steel} />
          {[
            [l / 2 - 0.55, w / 2 - 0.55],
            [l / 2 + 0.5, w / 2 + 0.5],
          ].map(([x, y]) => (
            <CBox key={x} min={[x, y + (y > w / 2 ? 0.3 : -0.3), -vehicle.deckHeight]} max={[x + 0.06, y + (y > w / 2 ? 0.36 : -0.24), h + 2.9]} material={MATERIALS.chassis} />
          ))}
          <mesh ref={stream} geometry={UNIT_BOX} material={heapMat} />
        </group>
      )}
      {interactive && hovered && <BodyTooltip {...props} />}
    </group>
  );
});

const bandMaterials = new Map<string, MeshStandardMaterial>();
function bandMaterial(color: string): MeshStandardMaterial {
  let m = bandMaterials.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: 0.5 });
    bandMaterials.set(color, m);
  }
  return m;
}

function BodyTooltip({ vehicle, fill, points, stops, customers, units }: TipperLayerProps) {
  const body = vehicle.bulk?.compartments[0];
  const { l, w, h } = vehicle.cargo;
  const pos = toThree(l / 2, w / 2, h + 0.5);
  const material = fill?.unit.spec.material;
  const legal = useMemo(() => {
    if (!fill || !material || !body) return null;
    return maxLegalFill(vehicle, points.filter((p) => p.id !== fill.unit.id), body, material);
  }, [vehicle, fill, material, body, points]);
  if (!body) return null;
  if (!fill || !material) {
    return (
      <SceneLabel position={pos} zIndex={40}>
        <div className="num w-max -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-card/95 px-2.5 py-1.5 font-mono text-xs text-ink-soft shadow-card">
          Dump body · empty · {formatMaterialVolume(body.capacityL, 'solid', units)}
        </div>
      </SceneLabel>
    );
  }
  const stop = stops.find((s) => s.id === fill.unit.stopId);
  const customer = customers.find((c) => c.id === stop?.customerId);
  const over = legal !== null && material.volumeL > legal.litres + 0.5;
  return (
    <SceneLabel position={pos} zIndex={40}>
      <div className="w-max max-w-72 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-card/95 px-2.5 py-2 text-xs shadow-card">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink">
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: materialColor(material.materialId, 'solid') }} />
          <span className="truncate">{material.name}</span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted">
          <dt>Volume</dt>
          <dd className="num font-mono text-ink-soft">
            {formatMaterialVolume(material.volumeL, 'solid', units)} / {formatMaterialVolume(body.capacityL, 'solid', units)}
          </dd>
          <dt>Fill</dt>
          <dd className="num font-mono text-ink-soft">{formatPercent(fill.fill)}</dd>
          <dt>Weight</dt>
          <dd className="num font-mono text-ink-soft">{formatMass(fill.unit.spec.weightKg, units)}</dd>
          <dt>Density</dt>
          <dd className="num font-mono text-ink-soft">{formatMaterialDensity(material.densityKgPerL, 'solid', units)}</dd>
          {legal && (
            <>
              <dt>Legal max</dt>
              <dd className={`num font-mono ${over ? 'font-semibold text-bad' : 'text-ink-soft'}`}>
                {formatMaterialVolume(legal.litres, 'solid', units)} ({legal.limitedBy})
              </dd>
            </>
          )}
          <dt>Stop</dt>
          <dd className="text-ink-soft">{stop ? `${stop.sequence} · ${customer?.name ?? stop.name}` : 'No stop'}</dd>
        </dl>
      </div>
    </SceneLabel>
  );
}
