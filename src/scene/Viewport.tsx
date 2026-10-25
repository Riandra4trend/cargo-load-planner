import { Canvas, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box3, type WebGLRenderer } from 'three';
import { allowedOrientations, compartmentFill, compartmentOf, expandUnits, isBulk, orientedSize, placementBox, type Box } from '../domain/geometry';
import { materialColor } from '../domain/materials';
import type { Id } from '../domain/types';
import { axleContributions, axleGroups, computeAxleState } from '../physics';
import { loadingSequence } from '../sim/sequence';
import { useActiveVehicle, useDisplayPlan, useEvaluation, useUnitSystem } from '../state/hooks';
import { useStore } from '../state/store';
import { AxleLabels, Callouts, CogMarker, DiffGhosts } from './Annotations';
import { CameraRig, type SceneView } from './CameraRig';
import { CargoLayer, type CargoHighlights, type CargoItem, type CargoTween } from './CargoLayer';
import { vecToThree } from './coords';
import { DockScene } from './DockScene';
import { DragGhost, useDragController } from './DragController';
import { DropGhostView, useCargoDrops } from './DropController';
import { LabelContext, LabelLayer, LabelProjector, LabelStore } from './labels';
import { Lighting } from './Lighting';
import { useSceneUi } from './sceneUi';
import { colorContext, unitColor, type ColorContext } from './palette';
import { LoadSimulation, simulationLayout, UnloadSimulation } from './Simulation';
import { dockLayout, type StagingUnit } from './staging';
import { DumpSite, TankerGantry, WarehouseRacks } from './SiteProps';
import { TankLayer, type TankFill } from './TankLayer';
import { TipperLayer } from './TipperLayer';
import { VehicleModel } from './VehicleModel';
import { vehicleLayout } from './vehicleLayout';
import { ViewportOverlay } from './ViewportOverlay';

const EMPTY_SET: ReadonlySet<Id> = new Set();
/** Body colour of the ghost shown while palette / table cargo is dragged over the truck. */
const DROP_GHOST_COLOR = '#f59e0b';

const toBox3 = (b: Box): Box3 => new Box3().setFromPoints([vecToThree(b.min), vecToThree(b.max)]);

/** The 3D load view: vehicle, dock, cargo, annotations, interaction and simulations, plus its DOM overlay. */
export function Viewport() {
  const glRef = useRef<WebGLRenderer | null>(null);
  const [labels] = useState(() => new LabelStore());
  const select = useStore((s) => s.select);
  return (
    <div className="relative h-full w-full touch-none select-none">
      <LabelContext.Provider value={labels}>
        <Canvas
          shadows="percentage"
          dpr={[1, 2]}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          onCreated={({ gl }) => {
            glRef.current = gl;
            gl.localClippingEnabled = true;
          }}
          onPointerMissed={(e) => {
            if (e.type === 'click' && !(e.shiftKey || e.ctrlKey || e.metaKey) && useStore.getState().ui.selection.length) select([]);
          }}
          aria-label="3D load view"
        >
          <color attach="background" args={['#f2f1ed']} />
          <SceneContent />
          <LabelProjector store={labels} />
        </Canvas>
        <LabelLayer store={labels} />
      </LabelContext.Provider>
      <ViewportOverlay glRef={glRef} />
    </div>
  );
}

function SceneContent() {
  const plan = useDisplayPlan();
  const evaluation = useEvaluation();
  const vehicle = useActiveVehicle();
  const units = useUnitSystem();
  const storeView = useStore((s) => s.ui.view);
  const colorMode = useStore((s) => s.ui.colorMode);
  const selection = useStore((s) => s.ui.selection);
  const hoverUnitId = useStore((s) => s.ui.hoverUnitId);
  const hoverAxle = useStore((s) => s.ui.hoverAxle);
  const animation = useStore((s) => s.ui.animation);
  const diff = useStore((s) => s.ui.optimise.diff);
  const drag = useStore((s) => s.ui.drag);
  const activeVehicleId = useStore((s) => s.ui.activeVehicleId);
  const setActiveVehicle = useStore((s) => s.setActiveVehicle);
  const setHover = useStore((s) => s.setHover);
  const view: SceneView = storeView === 'plan' ? '3d' : storeView;
  const look = useSceneUi((s) => s.look);
  const deliveries = useSceneUi((s) => s.deliveries);
  const committed = useStore((s) => s.plan);

  // An animation started for another vehicle brings that vehicle into view.
  useEffect(() => {
    if (animation.mode !== 'idle' && animation.vehicleId && animation.vehicleId !== activeVehicleId && plan.vehicles.some((v) => v.id === animation.vehicleId)) setActiveVehicle(animation.vehicleId);
  }, [animation.mode, animation.vehicleId, activeVehicleId, plan.vehicles, setActiveVehicle]);

  const veval = evaluation.byVehicle[vehicle.id];
  const layout = useMemo(() => vehicleLayout(vehicle), [vehicle]);
  const animMode = animation.mode !== 'idle' && (animation.vehicleId ?? vehicle.id) === vehicle.id ? animation.mode : 'idle';

  // Floor units are drawn as boxes / goods; bulk liquid fills live in tank compartments instead.
  const { vehicleItems, tankFills } = useMemo(() => {
    const items: CargoItem[] = [];
    const fills: TankFill[] = [];
    for (const u of evaluation.units) {
      const p = plan.placements[u.id];
      if (p?.vehicleId !== vehicle.id) continue;
      if (p.compartmentId !== undefined || isBulk(u.spec)) {
        const c = compartmentOf(vehicle, p.compartmentId);
        if (c) fills.push({ unit: u, compartment: c, fill: compartmentFill(u.spec, c) });
      } else items.push({ unit: u, orient: p.orient, box: placementBox(p, u.spec) });
    }
    return { vehicleItems: items, tankFills: fills };
  }, [evaluation.units, plan.placements, vehicle]);
  const fillBoxes = useMemo(
    () => new Map<Id, Box>(tankFills.map((f) => [f.unit.id, { min: { x: f.compartment.fromX, y: 0, z: 0 }, max: { x: f.compartment.toX, y: vehicle.cargo.w, z: vehicle.cargo.h } }])),
    [tankFills, vehicle.cargo.w, vehicle.cargo.h],
  );

  const sequence = useMemo(() => (animMode === 'load' ? loadingSequence(plan, vehicle.id) : []), [animMode, plan, vehicle.id]);
  const dragUnitId = drag && drag.ghost.vehicleId === vehicle.id ? drag.unitId : null;

  // Waiting goods: unplaced floor units of the committed plan stand in the staging lanes (a unit being
  // dragged in keeps its slot, so the lanes don't shift). Bulk vehicles load at the gantry / stockpile.
  const waitingItems = useMemo<CargoItem[]>(() => {
    if (vehicle.bulk) return [];
    return expandUnits(committed)
      .filter((u) => !committed.placements[u.id] && !isBulk(u.spec) && (!plan.placements[u.id] || u.id === dragUnitId))
      .map((u) => {
        const orient = allowedOrientations(u.spec)[0];
        const s = orientedSize(u.spec.dims, orient);
        return { unit: u, orient, box: { min: { x: 0, y: 0, z: 0 }, max: s } };
      });
  }, [committed, plan.placements, dragUnitId, vehicle.bulk]);

  // Forklift deliveries queued for this vehicle (idle view only).
  const queued = useMemo(() => {
    if (animMode !== 'idle' || diff) return [];
    const placed = new Set(vehicleItems.map((it) => it.unit.id));
    return deliveries.filter((id) => placed.has(id));
  }, [deliveries, vehicleItems, animMode, diff]);
  useEffect(() => {
    // Forget deliveries that are no longer placed here (undo, unplace, other vehicle).
    const placed = new Set(vehicleItems.map((it) => it.unit.id));
    const stale = deliveries.filter((id) => !placed.has(id));
    for (const id of stale) useSceneUi.getState().finishDelivery(id);
  }, [deliveries, vehicleItems]);

  // Staging lanes: waiting goods at the lane heads, then the vehicle's units in loading order (their
  // slots are where the load simulation and forklift deliveries pick them up).
  const stagingUnits = useMemo<StagingUnit[]>(() => {
    const byId = new Map(vehicleItems.map((it) => [it.unit.id, it]));
    const ordered = sequence.length ? sequence.map((s) => byId.get(s.unitId)).filter((it): it is CargoItem => !!it) : vehicleItems;
    return [...waitingItems, ...ordered].map((it) => ({ id: it.unit.id, stopId: it.unit.stopId, stopSeq: it.unit.stopSeq, size: orientedSize(it.unit.spec.dims, it.orient) }));
  }, [vehicleItems, sequence, waitingItems]);
  const stagingKey = `${vehicle.id}:${vehicle.cargo.l}:${vehicle.cargo.w}|${stagingUnits.map((u) => `${u.id}:${u.stopSeq}:${u.size.x.toFixed(3)}:${u.size.y.toFixed(3)}:${u.size.z.toFixed(3)}`).join('|')}`;
  const stagingRef = useRef({ key: '', dock: dockLayout(vehicle, stagingUnits) });
  if (stagingRef.current.key !== stagingKey) stagingRef.current = { key: stagingKey, dock: dockLayout(vehicle, stagingUnits) };
  const dock = stagingRef.current.dock;

  // Unload: remember the stage shown before the latest step so every stop passed since then leaves animated.
  const unloadTrack = useRef({ step: 0, from: 0 });
  if (animMode !== 'unload') unloadTrack.current = { step: 0, from: 0 };
  else if (unloadTrack.current.step !== animation.step) {
    unloadTrack.current = { step: animation.step, from: Math.min(unloadTrack.current.step, animation.step) };
  }
  const unloadFrom = unloadTrack.current.from;

  const baseSim = useMemo(
    () => simulationLayout(vehicleItems, animMode, animation.step, sequence, dock, unloadFrom),
    [vehicleItems, animMode, animation.step, sequence, dock, unloadFrom],
  );
  // Waiting goods in their lanes; queued deliveries wait in their lane until the forklift takes them.
  const sim = useMemo(() => {
    const atSlot = (it: CargoItem): CargoItem | null => {
      const slot = dock.slots.get(it.unit.id);
      return slot ? { ...it, box: slot } : null;
    };
    const waiting = waitingItems.map(atSlot).filter((it): it is CargoItem => !!it);
    if (!queued.length) return { ...baseSim, items: [...baseSim.items, ...waiting] };
    const queuedSet = new Set(queued);
    const head = baseSim.items.find((it) => it.unit.id === queued[0]);
    const slot = head ? dock.slots.get(head.unit.id) : undefined;
    const items = baseSim.items.flatMap((it) => (!queuedSet.has(it.unit.id) ? [it] : it.unit.id === queued[0] ? [] : [atSlot(it) ?? it]));
    return { ...baseSim, items: [...items, ...waiting], current: head && slot ? { item: head, slot } : null };
  }, [baseSim, waitingItems, queued, dock]);
  const deliveryCount = useRef(0);
  const finishDelivery = useCallback((unitId: Id) => {
    deliveryCount.current++;
    useSceneUi.getState().finishDelivery(unitId);
  }, []);
  const laneBoxOf = useCallback((unitId: Id) => (waitingItems.some((it) => it.unit.id === unitId) ? dock.slots.get(unitId) : undefined), [waitingItems, dock]);

  const colors = useMemo(() => colorContext(plan, evaluation.units, colorMode), [plan, evaluation.units, colorMode]);
  const colorsStable = useStableColors(colors);

  const layerItems = useMemo(() => (dragUnitId ? sim.items.filter((it) => it.unit.id !== dragUnitId) : sim.items), [sim.items, dragUnitId]);

  const axleIds = useMemo<ReadonlySet<Id>>(() => {
    if (!hoverAxle || hoverAxle.vehicleId !== vehicle.id || !veval) return EMPTY_SET;
    const gi = axleGroups(vehicle).findIndex((g) => g.id === hoverAxle.axleId);
    return gi < 0 ? EMPTY_SET : new Set(axleContributions(vehicle, veval.points, gi, 5).map((c) => c.id));
  }, [hoverAxle, vehicle, veval]);
  const highlights = useMemo<CargoHighlights>(() => ({ selected: new Set(selection), hover: hoverUnitId, axle: axleIds }), [selection, hoverUnitId, axleIds]);

  // Optimiser preview: ghosts at the old positions and a short tween to the new ones.
  const diffInfo = useMemo(() => {
    if (!diff) return null;
    const from = new Map<Id, Box>();
    const ghosts: Box[] = [];
    for (const u of evaluation.units) {
      const before = diff.base.placements[u.id];
      if (before?.vehicleId !== vehicle.id || isBulk(u.spec)) continue;
      const after = diff.preview.placements[u.id];
      const moved = !after || after.vehicleId !== before.vehicleId || after.orient !== before.orient || Math.abs(after.pos.x - before.pos.x) > 1e-6 || Math.abs(after.pos.y - before.pos.y) > 1e-6 || Math.abs(after.pos.z - before.pos.z) > 1e-6;
      if (!moved) continue;
      const box = placementBox(before, u.spec);
      ghosts.push(box);
      if (after?.vehicleId === vehicle.id) from.set(u.id, box);
    }
    return { tween: { key: diff, from } satisfies CargoTween, ghosts };
  }, [diff, evaluation.units, vehicle.id]);

  // Axle loads shown under the wheels follow the simulation (units aboard at the current step).
  const shownAxle = useMemo(() => {
    if (!veval) return null;
    if (animMode === 'unload') return veval.stages.find((s) => s.stage === animation.step)?.axle ?? computeAxleState(vehicle, veval.points.filter((p) => p.stopSeq > animation.step), plan.settings.nearLimit);
    if (animMode === 'load') {
      const aboard = new Set(sequence.slice(0, animation.step).map((s) => s.unitId));
      return computeAxleState(vehicle, veval.points.filter((p) => aboard.has(p.id)), plan.settings.nearLimit);
    }
    return veval.axle;
  }, [veval, animMode, animation.step, sequence, vehicle, plan.settings.nearLimit]);

  // The dragged unit's problems are shown on its ghost, not as callouts.
  const calloutBoxes = useMemo(() => {
    const map = new Map(layerItems.map((it) => [it.unit.id, it.box]));
    for (const [id, b] of fillBoxes) map.set(id, b);
    return map;
  }, [layerItems, fillBoxes]);

  const fit = useMemo(() => {
    const e = layout.extents;
    const box: Box = { min: { x: e.minX, y: e.minY, z: e.minZ }, max: { x: e.maxX, y: e.maxY, z: e.maxZ } };
    if (animMode === 'idle' && view === '3d' && !vehicle.bulk) {
      // Normal 3D view: the truck plus the front of the warehouse (lanes, forklift and racking).
      box.max.x = Math.max(box.max.x, dock.wallX + 7);
      box.max.y = Math.max(box.max.y, dock.rack.toY);
      box.max.z = Math.max(box.max.z, 4.3);
    } else if (animMode === 'idle' && view === '3d' && vehicle.kind === 'tipper') {
      // Dump trucks: include the stockpile and the wheel loader (see DumpSite).
      box.max.x = Math.max(box.max.x, vehicle.cargo.l + 6.5);
      box.min.y = Math.min(box.min.y, -4.6);
      box.max.y = Math.max(box.max.y, vehicle.cargo.w + 6.2);
    } else if (animMode !== 'idle') {
      box.max.x = Math.max(box.max.x, dock.floor.maxX);
      box.min.y = Math.min(box.min.y, dock.lanes[0]?.minY ?? box.min.y);
      box.max.y = Math.max(box.max.y, dock.lanes[dock.lanes.length - 1]?.maxY ?? box.max.y);
    }
    return toBox3(box);
  }, [layout, animMode, dock, view, vehicle.bulk, vehicle.kind, vehicle.cargo.l, vehicle.cargo.w]);
  // Refit on plan switches and geometry changes too: switching presets or loading another plan keeps vehicle ids.
  const ext = layout.extents;
  const fitKey = `${plan.id}:${vehicle.id}:${animMode}:${[ext.minX, ext.maxX, ext.minY, ext.maxY, ext.maxZ].map((n) => n.toFixed(1)).join(',')}`;

  // Sun / shadow coverage: the vehicle and the dock with its staging lanes (three.js coordinates).
  const sun = useMemo(() => {
    const e = layout.extents;
    const minX = e.minX;
    const maxX = Math.max(e.maxX, dock.floor.maxX);
    const minY = Math.min(e.minY, dock.floor.minY);
    const maxY = Math.max(e.maxY, dock.floor.maxY);
    return { centre: [(minX + maxX) / 2, 0, -(minY + maxY) / 2] as const, radius: Math.hypot(maxX - minX, maxY - minY) / 2 + 1 };
  }, [layout, dock]);

  const locateUnit = useCallback(
    (unitId: Id): Box3 | null => {
      const it = sim.items.find((x) => x.unit.id === unitId) ?? (sim.current?.item.unit.id === unitId ? sim.current.item : undefined);
      if (it) return toBox3(it.box);
      const fillBox = fillBoxes.get(unitId);
      if (fillBox) return toBox3(fillBox);
      const p = plan.placements[unitId];
      const u = evaluation.unitById.get(unitId);
      if (p && u && p.vehicleId === vehicle.id) return toBox3(placementBox(p, u.spec));
      return null;
    },
    [sim, plan.placements, evaluation.unitById, vehicle.id, fillBoxes],
  );

  // Focus requests for units in another vehicle switch the active vehicle (the camera rig then follows).
  const focus = useStore((s) => s.ui.focus);
  useEffect(() => {
    if (!focus.unitId) return;
    const s = useStore.getState();
    const p = s.plan.placements[focus.unitId];
    if (p && p.vehicleId !== s.ui.activeVehicleId) s.setActiveVehicle(p.vehicleId);
  }, [focus]);

  const onUnitPointerDown = useDragController(vehicle, animMode === 'idle' && !diff, laneBoxOf);
  const dropPreview = useCargoDrops(vehicle, animMode === 'idle' && !diff);
  const onUnitHover = useCallback((id: Id | null) => setHover(id), [setHover]);

  const dragUnit = dragUnitId ? evaluation.unitById.get(dragUnitId) : undefined;
  const leavingColors = useMemo(() => new Map(sim.leaving.map(({ item }) => [item.unit.id, unitColor(item.unit, colorsStable)])), [sim.leaving, colorsStable]);
  const maxStop = useMemo(() => [...vehicleItems, ...tankFills].reduce((m, it) => Math.max(m, it.unit.stopSeq), 0), [vehicleItems, tankFills]);
  const fillStep = animMode === 'load' && !!sequence[animation.step]?.compartmentId;
  // Dump-truck stockpile: the plan's first dry bulk material.
  const siteMaterialColor = useMemo(() => {
    const solid = plan.lines.find((l) => l.spec.material?.state === 'solid')?.spec.material;
    return materialColor(solid?.materialId ?? 'custom', 'solid');
  }, [plan.lines]);
  useDeliverySkip(queued.length > 0);

  if (!veval) return null;
  return (
    <>
      <Lighting centre={sun.centre} radius={sun.radius} />
      <CameraRig view={view} fitBox={fit} fitKey={fitKey} locateUnit={locateUnit} />
      <VehicleModel vehicle={vehicle} wingsOpen={animMode === 'load' && vehicle.body === 'wingbox'} />
      {/* Dump trucks tip at the site: no loading dock behind them (the material pile lands there). */}
      <DockScene vehicle={vehicle} dock={dock} stops={plan.stops} customers={plan.customers} groundOnly={vehicle.kind === 'tipper'} />
      <CargoLayer
        items={layerItems}
        colors={colorsStable}
        highlights={highlights}
        tween={diffInfo?.tween ?? null}
        stops={plan.stops}
        customers={plan.customers}
        units={units}
        onUnitPointerDown={onUnitPointerDown}
        onUnitHover={onUnitHover}
        suspended={!!drag || animMode !== 'idle'}
        look={look}
      />
      {dragUnit && <DragGhost spec={dragUnit.spec} color={unitColor(dragUnit, colorsStable)} />}
      <DropGhostView preview={dropPreview} color={DROP_GHOST_COLOR} />
      {vehicle.kind === 'tipper' && (
        <TipperLayer
          vehicle={vehicle}
          fill={tankFills[0] ?? null}
          points={veval.points}
          colors={colorsStable}
          highlights={highlights}
          stops={plan.stops}
          customers={plan.customers}
          units={units}
          animMode={animMode}
          step={animation.step}
          playing={animation.playing}
          speed={animation.speed}
          sequence={sequence}
          unloadFrom={unloadFrom}
          interactive={animMode === 'idle' && !diff && !drag}
        />
      )}
      {vehicle.kind === 'tanker' && (
        <TankLayer
          vehicle={vehicle}
          fills={tankFills}
          colors={colorsStable}
          highlights={highlights}
          stops={plan.stops}
          customers={plan.customers}
          units={units}
          animMode={animMode}
          step={animation.step}
          playing={animation.playing}
          speed={animation.speed}
          sequence={sequence}
          unloadFrom={unloadFrom}
          dockX={dock.wallX}
          interactive={animMode === 'idle' && !diff && !drag}
        />
      )}
      {diffInfo && <DiffGhosts boxes={diffInfo.ghosts} />}
      {shownAxle && <AxleLabels vehicle={vehicle} axle={shownAxle} groupX={layout.groupX} units={units} />}
      {shownAxle?.cog && <CogMarker cog={shownAxle.cog} vehicle={vehicle} />}
      {animMode === 'idle' && <Callouts violations={veval.violations} boxes={calloutBoxes} />}
      {!vehicle.bulk &&
        (animMode === 'load' ? (
          <LoadSimulation
            dock={dock}
            current={sim.current}
            step={animation.step}
            total={sequence.length}
            playing={animation.playing}
            speed={animation.speed}
            color={sim.current ? unitColor(sim.current.item.unit, colorsStable) : null}
            realistic={look === 'realistic'}
            waiting={fillStep}
          />
        ) : (
          // Parked by the lanes, or carrying queued deliveries into the truck one by one.
          <LoadSimulation
            dock={dock}
            current={animMode === 'idle' ? sim.current : null}
            step={deliveryCount.current}
            total={queued.length}
            playing={animMode === 'idle'}
            speed={1}
            color={sim.current ? unitColor(sim.current.item.unit, colorsStable) : null}
            realistic={look === 'realistic'}
            waiting={false}
            onDone={() => sim.current && finishDelivery(sim.current.item.unit.id)}
          />
        ))}
      {vehicle.kind === 'tanker' && <TankerGantry vehicle={vehicle} />}
      {vehicle.kind === 'tipper' && <DumpSite vehicle={vehicle} color={siteMaterialColor} />}
      {!vehicle.bulk && <WarehouseRacks rack={dock.rack} />}
      {animMode === 'unload' && (
        <UnloadSimulation vehicle={vehicle} leaving={sim.leaving} step={animation.step} maxStep={maxStop} playing={animation.playing} speed={animation.speed} colors={leavingColors} realistic={look === 'realistic'} />
      )}
    </>
  );
}

/** A click in the viewport or Esc skips the remaining forklift deliveries (they are already placed). */
function useDeliverySkip(active: boolean): void {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!active) return;
    const skip = () => useSceneUi.getState().clearDeliveries();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') skip();
    };
    window.addEventListener('keydown', onKey);
    gl.domElement.addEventListener('pointerdown', skip);
    return () => {
      window.removeEventListener('keydown', onKey);
      gl.domElement.removeEventListener('pointerdown', skip);
    };
  }, [active, gl]);
}

/**
 * The colour context only changes visible colours when the mode, the stop/customer colours or the
 * heaviest unit change; keep its identity stable otherwise so the instanced colours are not rewritten
 * on every drag frame.
 */
function useStableColors(ctx: ColorContext): ColorContext {
  const key = `${ctx.mode}|${ctx.maxKg}|${[...ctx.stopColors].map(([k, v]) => `${k}=${v}`).join(',')}`;
  const ref = useRef({ key, ctx });
  if (ref.current.key !== key) ref.current = { key, ctx };
  return ref.current.ctx;
}
