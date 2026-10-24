import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box3, type WebGLRenderer } from 'three';
import { compartmentFill, compartmentOf, isBulkLiquid, orientedSize, placementBox, type Box } from '../domain/geometry';
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
import { LabelContext, LabelLayer, LabelProjector, LabelStore } from './labels';
import { Lighting } from './Lighting';
import { useSceneUi } from './sceneUi';
import { colorContext, unitColor, type ColorContext } from './palette';
import { LoadSimulation, simulationLayout, UnloadSimulation } from './Simulation';
import { dockLayout, type StagingUnit } from './staging';
import { TankLayer, type TankFill } from './TankLayer';
import { VehicleModel } from './VehicleModel';
import { vehicleLayout } from './vehicleLayout';
import { ViewportOverlay } from './ViewportOverlay';

const EMPTY_SET: ReadonlySet<Id> = new Set();

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
      if (p.compartmentId !== undefined || isBulkLiquid(u.spec)) {
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

  // Staging lanes depend only on which units (and footprints) the vehicle carries, in loading order.
  const stagingUnits = useMemo<StagingUnit[]>(() => {
    const byId = new Map(vehicleItems.map((it) => [it.unit.id, it]));
    const ordered = sequence.length ? sequence.map((s) => byId.get(s.unitId)).filter((it): it is CargoItem => !!it) : vehicleItems;
    return ordered.map((it) => ({ id: it.unit.id, stopId: it.unit.stopId, stopSeq: it.unit.stopSeq, size: orientedSize(it.unit.spec.dims, it.orient) }));
  }, [vehicleItems, sequence]);
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

  const sim = useMemo(
    () => simulationLayout(vehicleItems, animMode, animation.step, sequence, dock, unloadFrom),
    [vehicleItems, animMode, animation.step, sequence, dock, unloadFrom],
  );

  const colors = useMemo(() => colorContext(plan, evaluation.units, colorMode), [plan, evaluation.units, colorMode]);
  const colorsStable = useStableColors(colors);

  const dragUnitId = drag && drag.ghost.vehicleId === vehicle.id ? drag.unitId : null;
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
      if (before?.vehicleId !== vehicle.id || isBulkLiquid(u.spec)) continue;
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
    if (animMode !== 'idle') {
      box.max.x = Math.max(box.max.x, dock.floor.maxX);
      box.min.y = Math.min(box.min.y, dock.lanes[0]?.minY ?? box.min.y);
      box.max.y = Math.max(box.max.y, dock.lanes[dock.lanes.length - 1]?.maxY ?? box.max.y);
    }
    return toBox3(box);
  }, [layout, animMode, dock]);
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

  const onUnitPointerDown = useDragController(vehicle, animMode === 'idle' && !diff);
  const onUnitHover = useCallback((id: Id | null) => setHover(id), [setHover]);

  const dragUnit = dragUnitId ? evaluation.unitById.get(dragUnitId) : undefined;
  const leavingColors = useMemo(() => new Map(sim.leaving.map(({ item }) => [item.unit.id, unitColor(item.unit, colorsStable)])), [sim.leaving, colorsStable]);
  const maxStop = useMemo(() => [...vehicleItems, ...tankFills].reduce((m, it) => Math.max(m, it.unit.stopSeq), 0), [vehicleItems, tankFills]);
  const fillStep = animMode === 'load' && !!sequence[animation.step]?.compartmentId;

  if (!veval) return null;
  return (
    <>
      <Lighting centre={sun.centre} radius={sun.radius} />
      <CameraRig view={view} fitBox={fit} fitKey={fitKey} locateUnit={locateUnit} />
      <VehicleModel vehicle={vehicle} />
      <DockScene vehicle={vehicle} dock={dock} stops={plan.stops} customers={plan.customers} />
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
      {animMode === 'load' && (
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
      )}
      {animMode === 'unload' && (
        <UnloadSimulation vehicle={vehicle} leaving={sim.leaving} step={animation.step} maxStep={maxStop} playing={animation.playing} speed={animation.speed} colors={leavingColors} realistic={look === 'realistic'} />
      )}
    </>
  );
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
