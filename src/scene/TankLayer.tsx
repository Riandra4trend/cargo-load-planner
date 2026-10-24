import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, Plane, Raycaster, Vector2, Vector3, type Group, type Mesh } from 'three';
import { hazmatColor, heatColor } from '../domain/colors';
import type { CargoUnit, Customer, Id, Stop, TankCompartment, UnitSystem, Vehicle } from '../domain/types';
import { liquidColor } from '../domain/liquids';
import { formatLiquidDensity, formatLitres, formatMass, formatPercent } from '../domain/units';
import { validateMove } from '../rules';
import type { LoadStep } from '../sim/sequence';
import { useStore } from '../state/store';
import type { CargoHighlights } from './CargoLayer';
import { setThree, toThree } from './coords';
import { pointerToCargoPlane } from './DragController';
import { interaction, syncControls } from './interaction';
import { SceneLabel } from './labels';
import { MATERIALS, UNIT_PLANE } from './materials';
import { unitColor, type ColorContext } from './palette';
import { CCyl } from './prims';
import { UNLOAD_STEP_S } from './Simulation';
import { chordWidth, compartmentAtX, hazardIdNumber, liquidLevel, tankBarrel } from './tankMath';
import { X_BAND, X_CYLINDER, X_HEAD } from './TankModel';
import { adrPlateTexture, hazmatTexture } from './textures';
import { vehicleLayout } from './vehicleLayout';

/** One bulk fill shown in a compartment. */
export interface TankFill {
  unit: CargoUnit;
  compartment: TankCompartment;
  /** Volume / brim capacity (0..1+). */
  fill: number;
}

/** Seconds to fill one compartment in the load animation at speed 1. */
const FILL_STEP_S = 2.2;
/** Liquid sits slightly inside the shell. */
const INNER = 0.97;
const DRAG_THRESHOLD_PX = 5;

// ---------------------------------------------------------------------------------------------
// Liquid body: elliptical section clipped at the level for the fill fraction
// ---------------------------------------------------------------------------------------------

export interface LiquidBodyProps {
  /** Cylindrical extent along cargo x. */
  fromX: number;
  toX: number;
  /** Tank cross-section (full width / height); the section bottom is at cargo z = 0. */
  width: number;
  height: number;
  /** Head depths at the ends of this segment (0 = flat bulkhead). */
  frontHead: number;
  rearHead: number;
  color: string;
  /** Static fill (0..1 of the section). */
  fill: number;
  /** Animated fill; read every frame when given (overrides `fill`). */
  fillRef?: RefObject<number>;
}

/** Liquid inside a tank segment: body + heads clipped by a horizontal plane, with a lighter surface. */
export function LiquidBody({ fromX, toX, width, height, frontHead, rearHead, color, fill, fillRef }: LiquidBodyProps) {
  const plane = useMemo(() => new Plane(new Vector3(0, -1, 0), 0), []);
  const materials = useMemo(() => {
    const body = new MeshStandardMaterial({ color, transparent: true, opacity: 0.82, side: DoubleSide, roughness: 0.25, metalness: 0.05, clippingPlanes: [plane] });
    const surface = new MeshStandardMaterial({ color: new Color(color).lerp(new Color('#ffffff'), 0.35), transparent: true, opacity: 0.92, side: DoubleSide, roughness: 0.1 });
    return { body, surface };
  }, [color, plane]);
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);
  const group = useRef<Group>(null);
  const surface = useRef<Mesh>(null);
  const hi = height * INNER;
  const wi = width * INNER;
  const bottom = (height - hi) / 2;
  const apply = useCallback(
    (f: number) => {
      const g = group.current;
      const s = surface.current;
      if (!g || !s) return;
      const clamped = Math.min(1, Math.max(0, f));
      const visible = clamped > 0.002;
      g.visible = visible;
      const level = bottom + liquidLevel(clamped, hi);
      plane.constant = clamped >= 0.999 ? 1e6 : level;
      s.visible = visible && clamped < 0.999;
      setThree(s.position, (fromX + toX) / 2, width / 2, level);
      s.scale.set(toX - fromX, chordWidth(level - bottom, wi, hi), 1);
    },
    [bottom, fromX, height, hi, plane, toX, wi, width],
  );
  useLayoutEffect(() => apply(fill), [apply, fill]);
  useFrame(() => {
    if (fillRef) apply(fillRef.current ?? fill);
  });
  return (
    <group>
      <group ref={group}>
        <mesh geometry={X_CYLINDER} material={materials.body} position={toThree((fromX + toX) / 2, width / 2, height / 2)} scale={[toX - fromX, hi, wi]} />
        {frontHead > 0 && <mesh geometry={X_HEAD} material={materials.body} position={toThree(fromX, width / 2, height / 2)} scale={[-frontHead * 2 * INNER, hi, wi]} />}
        {rearHead > 0 && <mesh geometry={X_HEAD} material={materials.body} position={toThree(toX, width / 2, height / 2)} scale={[rearHead * 2 * INNER, hi, wi]} />}
      </group>
      <mesh ref={surface} geometry={UNIT_PLANE} material={materials.surface} rotation={[-Math.PI / 2, 0, 0]} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Tank layer: liquids, colour-mode bands, placards, picking, tooltips, drag, fill / drain animation
// ---------------------------------------------------------------------------------------------

export interface TankLayerProps {
  vehicle: Vehicle;
  fills: TankFill[];
  colors: ColorContext;
  highlights: CargoHighlights;
  stops: Stop[];
  customers: Customer[];
  units: UnitSystem;
  animMode: 'idle' | 'load' | 'unload';
  step: number;
  playing: boolean;
  speed: number;
  /** Load sequence (fill steps first). */
  sequence: LoadStep[];
  /** Unload: stops up to this one had already left before the current step. */
  unloadFrom: number;
  /** Dock face x (loading arm gantry). */
  dockX: number;
  /** Picking, hover and drag enabled. */
  interactive: boolean;
}

const bandMaterials = new Map<string, MeshStandardMaterial>();
function bandMaterial(color: string): MeshStandardMaterial {
  let m = bandMaterials.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1, side: DoubleSide });
    bandMaterials.set(color, m);
  }
  return m;
}
const plateMaterials = new Map<string, MeshBasicMaterial>();
function plateMaterial(key: string, make: () => MeshBasicMaterial): MeshBasicMaterial {
  let m = plateMaterials.get(key);
  if (!m) {
    m = make();
    plateMaterials.set(key, m);
  }
  return m;
}
const PICK = new MeshBasicMaterial({ visible: false });
/** Compartment highlight: coloured rings at both ends plus rails along the top and bottom (no hull, so levels stay visible). */
const OUTLINES = {
  selected: new MeshBasicMaterial({ color: '#f59e0b', side: DoubleSide }),
  hover: new MeshBasicMaterial({ color: '#1d1d1b', side: DoubleSide }),
  axle: new MeshBasicMaterial({ color: '#2563eb', side: DoubleSide }),
  valid: new MeshBasicMaterial({ color: '#15803d', side: DoubleSide }),
  invalid: new MeshBasicMaterial({ color: '#c2261d', side: DoubleSide }),
};

interface DragTarget {
  compartmentId: Id;
  ok: boolean;
  reason: string;
}

export const TankLayer = memo(function TankLayer(props: TankLayerProps) {
  const { vehicle, fills, colors, highlights, animMode, step, playing, speed, sequence, unloadFrom, interactive } = props;
  const { w, h } = vehicle.cargo;
  const compartments = useMemo(() => vehicle.tank?.compartments ?? [], [vehicle.tank]);
  const barrel = tankBarrel(vehicle);
  const byCompartment = useMemo(() => new Map(fills.map((f) => [f.compartment.id, f])), [fills]);

  // Animated fill per compartment (written every frame, read by LiquidBody).
  const levels = useMemo(() => new Map(compartments.map((c) => [c.id, { current: byCompartment.get(c.id)?.fill ?? 0 }])), [compartments, byCompartment]);
  const stepIndex = useMemo(() => new Map(sequence.map((s, i) => [s.unitId, i])), [sequence]);
  const currentFillStep = animMode === 'load' && sequence[step]?.compartmentId ? sequence[step] : null;
  const progress = useRef(0);
  const elapsed = useRef(0);
  const lastStep = useRef(step);
  const advanced = useRef(false);
  useLayoutEffect(() => {
    if (lastStep.current !== step) {
      lastStep.current = step;
      progress.current = 0;
      elapsed.current = 0;
      advanced.current = false;
    }
  }, [step]);
  useLayoutEffect(() => {
    progress.current = 0;
    elapsed.current = 0;
    advanced.current = false;
  }, [animMode]);

  useFrame((_, delta) => {
    if (animMode === 'load' && currentFillStep && playing) {
      progress.current = Math.min(1, progress.current + (delta * speed) / FILL_STEP_S);
      if (progress.current >= 1 && !advanced.current) {
        advanced.current = true;
        useStore.getState().setAnimation(step + 1 >= sequence.length ? { step: step + 1, playing: false } : { step: step + 1 });
      }
    }
    if (animMode === 'unload') elapsed.current += delta * speed;
    const drain = Math.min(1, elapsed.current / (UNLOAD_STEP_S * 0.75));
    for (const c of compartments) {
      const ref = levels.get(c.id);
      const f = byCompartment.get(c.id);
      if (!ref) continue;
      if (!f) ref.current = 0;
      else if (animMode === 'load') {
        const i = stepIndex.get(f.unit.id) ?? -1;
        ref.current = i < step ? f.fill : i === step ? f.fill * progress.current : 0;
      } else if (animMode === 'unload') {
        const seq = f.unit.stopSeq;
        ref.current = seq > step ? f.fill : seq <= unloadFrom ? 0 : f.fill * (1 - drain);
      } else ref.current = f.fill;
    }
  });

  // ---- hover, selection and drag ----
  const [hovered, setHovered] = useState<Id | null>(null);
  const [target, setTarget] = useState<DragTarget | null>(null);
  const [dragging, setDragging] = useState<Id | null>(null);
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const raycaster = useMemo(() => new Raycaster(), []);
  const session = useRef<{ compartmentId: Id; unitId: Id | null; pointerId: number; x: number; y: number; additive: boolean; started: boolean } | null>(null);
  const targetRef = useRef<DragTarget | null>(null);
  targetRef.current = target;

  const finish = useCallback(() => {
    session.current = null;
    setDragging(null);
    setTarget(null);
    interaction.dragging = false;
    syncControls();
  }, []);

  useEffect(() => {
    const ndc = new Vector2();
    const onMove = (ev: PointerEvent) => {
      const s = session.current;
      if (!s || ev.pointerId !== s.pointerId || !s.unitId) return;
      if (!s.started) {
        if (Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < DRAG_THRESHOLD_PX) return;
        s.started = true;
        setDragging(s.unitId);
      }
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      const p = pointerToCargoPlane(raycaster, get().camera, ndc, h / 2, w / 2);
      const c = p && p.x > -1 && p.x < vehicle.cargo.l + 1 ? compartmentAtX(vehicle, p.x) : undefined;
      if (!c) {
        if (targetRef.current) setTarget(null);
        return;
      }
      if (targetRef.current?.compartmentId === c.id) return;
      if (c.id === s.compartmentId) {
        setTarget({ compartmentId: c.id, ok: true, reason: '' });
        return;
      }
      const check = validateMove(useStore.getState().plan, { unitId: s.unitId, vehicleId: vehicle.id, compartmentId: c.id, pos: { x: c.fromX, y: 0, z: 0 }, orient: 0 });
      setTarget({ compartmentId: c.id, ok: check.ok, reason: check.reasons[0] ?? '' });
    };
    const onUp = (ev: PointerEvent) => {
      const s = session.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      const store = useStore.getState();
      if (!s.started) {
        if (s.unitId) store.select([s.unitId], s.additive ? 'toggle' : 'replace');
        else if (!s.additive) store.select([]);
      } else if (s.unitId) {
        const t = targetRef.current;
        const label = compartments.find((c) => c.id === t?.compartmentId)?.label;
        if (t && t.compartmentId !== s.compartmentId) {
          if (t.ok) store.assignCompartment(s.unitId, vehicle.id, t.compartmentId);
          else store.toast(`Can't move to ${label}: ${t.reason || 'blocked'}`, 'error');
        }
        store.select([s.unitId], 'replace');
      }
      finish();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && session.current?.started) {
        ev.preventDefault();
        ev.stopPropagation();
        finish();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [compartments, finish, get, gl, h, raycaster, vehicle, w]);
  useEffect(() => () => finish(), [finish]);

  const setHover = useStore((s) => s.setHover);
  const hoverCompartment = useCallback(
    (id: Id | null) => {
      setHovered(id);
      setHover(id ? (byCompartment.get(id)?.unit.id ?? null) : null);
    },
    [byCompartment, setHover],
  );
  useEffect(() => {
    if (!interactive) setHovered(null);
  }, [interactive]);

  const handlers = (c: TankCompartment) => ({
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (interactive && !session.current?.started && hovered !== c.id) hoverCompartment(c.id);
    },
    onPointerOut: () => {
      if (hovered === c.id) hoverCompartment(null);
    },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0 || !interactive) return;
      e.stopPropagation();
      const ev = e.nativeEvent;
      session.current = { compartmentId: c.id, unitId: byCompartment.get(c.id)?.unit.id ?? null, pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, additive: ev.shiftKey || ev.ctrlKey || ev.metaKey, started: false };
      interaction.dragging = true;
      syncControls();
    },
  });

  const layout = useMemo(() => vehicleLayout(vehicle), [vehicle]);
  const anyHazmat = fills.some((f) => f.unit.spec.hazmat);
  const blankPlate = plateMaterial('adr-blank', () => new MeshBasicMaterial({ map: adrPlateTexture('', ''), side: DoubleSide }));
  const frontX = Math.min(layout.cab.fromX, layout.hood?.fromX ?? layout.cab.fromX) - 0.2;

  return (
    <group>
      {compartments.map((c) => {
        const f = byCompartment.get(c.id) ?? null;
        const first = c.fromX <= compartments[0].fromX + 1e-6;
        const last = c.toX >= compartments[compartments.length - 1].toX - 1e-6;
        const x0 = Math.max(c.fromX, barrel.x0) + (first ? 0 : 0.015);
        const x1 = Math.min(c.toX, barrel.x1) - (last ? 0 : 0.015);
        const cx = (c.fromX + c.toX) / 2;
        const len = c.toX - c.fromX;
        const unitId = f?.unit.id;
        const outline =
          target?.compartmentId === c.id && dragging
            ? target.ok
              ? OUTLINES.valid
              : OUTLINES.invalid
            : unitId && highlights.selected.has(unitId)
              ? OUTLINES.selected
              : hovered === c.id || (unitId && highlights.hover === unitId)
                ? OUTLINES.hover
                : unitId && highlights.axle.has(unitId)
                  ? OUTLINES.axle
                  : null;
        const liquidId = f?.unit.spec.liquid?.liquidId ?? 'custom';
        const liquid = colors.mode === 'weight' && f ? heatColor(colors.maxKg > 0 ? f.unit.spec.weightKg / colors.maxKg : 0) : liquidColor(liquidId);
        const haz = f?.unit.spec.hazmat;
        return (
          <group key={c.id}>
            {f && (
              <LiquidBody
                fromX={x0}
                toX={x1}
                width={w}
                height={h}
                frontHead={first ? barrel.head : 0}
                rearHead={last ? barrel.head : 0}
                color={liquid}
                fill={f.fill}
                fillRef={levels.get(c.id)}
              />
            )}
            {f && <mesh geometry={X_BAND} material={bandMaterial(unitColor(f.unit, colors))} position={toThree(cx, w / 2, h / 2)} scale={[Math.min(0.32, len * 0.14), h * 1.03, w * 1.03]} />}
            {haz && (
              <>
                <mesh
                  geometry={UNIT_PLANE}
                  material={plateMaterial(`haz:${haz.hazClass}`, () => new MeshBasicMaterial({ map: hazmatTexture(haz.hazClass, hazmatColor(haz.hazClass)), transparent: true, alphaTest: 0.4, side: DoubleSide }))}
                  position={toThree(cx - Math.min(0.55, len * 0.22), -0.03, h * 0.5)}
                  scale={[0.55, 0.55, 1]}
                />
                <mesh
                  geometry={UNIT_PLANE}
                  material={plateMaterial(`adr:${haz.unNumber}`, () => new MeshBasicMaterial({ map: adrPlateTexture(hazardIdNumber(haz), haz.unNumber), side: DoubleSide }))}
                  position={toThree(cx + Math.min(0.5, len * 0.2), -0.03, h * 0.5)}
                  scale={[0.4, 0.3, 1]}
                />
              </>
            )}
            <mesh geometry={X_CYLINDER} material={PICK} position={toThree(cx, w / 2, h / 2)} scale={[len, h, w]} {...handlers(c)} />
            {outline && <CompartmentOutline fromX={c.fromX} toX={c.toX} width={w} height={h} material={outline} />}
            {interactive && hovered === c.id && !dragging && <CompartmentTooltip {...props} compartment={c} fill={f} />}
            {dragging && target?.compartmentId === c.id && !target.ok && target.reason && (
              <SceneLabel position={toThree(cx, w / 2, h + 0.7)} zIndex={45}>
                <div className="w-max max-w-72 -translate-x-1/2 -translate-y-full rounded-md bg-bad px-2 py-1 text-xs font-medium text-white shadow-card">{target.reason}</div>
              </SceneLabel>
            )}
          </group>
        );
      })}
      {anyHazmat && (
        <>
          <mesh geometry={UNIT_PLANE} material={blankPlate} position={toThree(barrel.x1 + barrel.head + 0.1, w / 2, -0.35)} rotation={[0, Math.PI / 2, 0]} scale={[0.4, 0.3, 1]} />
          <mesh geometry={UNIT_PLANE} material={blankPlate} position={toThree(frontX, w / 2, -vehicle.deckHeight + 0.62)} rotation={[0, -Math.PI / 2, 0]} scale={[0.4, 0.3, 1]} />
        </>
      )}
      {currentFillStep?.compartmentId && <LoadingArm vehicle={vehicle} compartment={compartments.find((c) => c.id === currentFillStep.compartmentId)} dockX={props.dockX} />}
    </group>
  );
});

function CompartmentOutline({ fromX, toX, width, height, material }: { fromX: number; toX: number; width: number; height: number; material: MeshBasicMaterial }) {
  const len = toX - fromX;
  return (
    <group raycast={() => undefined}>
      {[fromX + 0.04, toX - 0.04].map((x) => (
        <mesh key={x} geometry={X_BAND} material={material} position={toThree(x, width / 2, height / 2)} scale={[0.07, height * 1.05, width * 1.05]} raycast={() => undefined} />
      ))}
      {[height + 0.02, -0.02].map((z) => (
        <mesh key={z} geometry={X_CYLINDER} material={material} position={toThree((fromX + toX) / 2, width / 2, z)} scale={[len, 0.035, 0.035]} raycast={() => undefined} />
      ))}
    </group>
  );
}

/** Loading arm from the gantry at the dock face down into the compartment's manhole. */
function LoadingArm({ vehicle, compartment, dockX }: { vehicle: Vehicle; compartment: TankCompartment | undefined; dockX: number }) {
  if (!compartment) return null;
  const { w, h } = vehicle.cargo;
  const cx = (compartment.fromX + compartment.toX) / 2;
  const top = h + 2.2;
  return (
    <group>
      <CCyl centre={[dockX + 0.3, -0.6, top / 2]} radius={0.09} length={top} axis={2} material={MATERIALS.steel} />
      <CCyl centre={[(cx + dockX + 0.3) / 2, -0.6, top]} radius={0.07} length={Math.abs(dockX + 0.3 - cx)} axis={0} material={MATERIALS.steel} />
      <CCyl centre={[cx, (w / 2 - 0.6) / 2, top]} radius={0.07} length={w / 2 + 0.6} axis={1} material={MATERIALS.steel} />
      <CCyl centre={[cx, w / 2, (h + top) / 2]} radius={0.075} length={top - h} axis={2} material={MATERIALS.forklift} />
    </group>
  );
}

function CompartmentTooltip({ compartment: c, fill: f, vehicle, stops, customers, units }: { compartment: TankCompartment; fill: TankFill | null } & TankLayerProps) {
  const { w, h } = vehicle.cargo;
  const pos = toThree((c.fromX + c.toX) / 2, w / 2, h + 0.4);
  if (!f) {
    return (
      <SceneLabel position={pos} zIndex={40}>
        <div className="num w-max -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-card/95 px-2.5 py-1.5 font-mono text-xs text-ink-soft shadow-card">
          {c.label} · empty · {formatLitres(c.capacityL, units, 0)}
        </div>
      </SceneLabel>
    );
  }
  const { spec } = f.unit;
  const liquid = spec.liquid;
  const stop = stops.find((s) => s.id === f.unit.stopId);
  const customer = customers.find((x) => x.id === stop?.customerId);
  return (
    <SceneLabel position={pos} zIndex={40}>
      <div className="w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-card/95 px-2.5 py-2 text-xs shadow-card">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink">
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: liquidColor(liquid?.liquidId ?? 'custom') }} />
          <span className="truncate">
            {c.label} · {liquid?.name ?? spec.name}
          </span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted">
          <dt>Volume</dt>
          <dd className="num font-mono text-ink-soft">
            {formatLitres(liquid?.volumeL ?? 0, units, 0)} / {formatLitres(c.capacityL, units, 0)}
          </dd>
          <dt>Fill</dt>
          <dd className="num font-mono text-ink-soft">{formatPercent(f.fill)}</dd>
          <dt>Weight</dt>
          <dd className="num font-mono text-ink-soft">{formatMass(spec.weightKg, units)}</dd>
          {liquid && (
            <>
              <dt>Density</dt>
              <dd className="num font-mono text-ink-soft">{formatLiquidDensity(liquid.densityKgPerL, units)}</dd>
            </>
          )}
          <dt>Stop</dt>
          <dd className="text-ink-soft">{stop ? `${stop.sequence} · ${customer?.name ?? stop.name}` : 'No stop'}</dd>
          {spec.hazmat && (
            <>
              <dt>Hazmat</dt>
              <dd className="text-ink-soft">
                {spec.hazmat.unNumber} · class {spec.hazmat.hazClass}
              </dd>
            </>
          )}
        </dl>
      </div>
    </SceneLabel>
  );
}
