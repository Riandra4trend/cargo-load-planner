import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { MeshBasicMaterial, Plane, Raycaster, Vector2, Vector3, type Camera } from 'three';
import { allowedOrientations, boxCenter, expandUnits, orientedSize, placementBox } from '../domain/geometry';
import type { Id, ItemSpec, Orientation, Placement, Vehicle } from '../domain/types';
import { validateMove } from '../rules';
import { useStore } from '../state/store';
import { boxToThree, threeToCargo, toThree } from './coords';
import { dragCandidate, dragContext, type DragContext } from './dragMath';
import { interaction, syncControls } from './interaction';
import { SceneLabel } from './labels';
import { UNIT_BOX } from './materials';
import { boxEdgePoints, CLines } from './prims';
import { UnitMesh } from './UnitMesh';

const DRAG_THRESHOLD_PX = 5;

interface Session {
  unitId: Id;
  pointerId: number;
  startX: number;
  startY: number;
  additive: boolean;
  /** Dragging is allowed (unit placed in the active vehicle, no animation / optimiser preview). */
  draggable: boolean;
  started: boolean;
  ctx: DragContext | null;
  origin: Placement | null;
  spec: ItemSpec | null;
  orient: Orientation;
  /** Offset from the pointer's floor hit to the unit's footprint centre (cargo x / y). */
  grab: { x: number; y: number };
  /** Current footprint centre y (kept in the side view, where the pointer cannot move across). */
  centreY: number;
  ndc: Vector2;
  dirty: boolean;
}

const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
const sidePlane = new Plane(new Vector3(0, 0, 1), 0);
const hit = new Vector3();

/**
 * Cargo x / y under the pointer: on the horizontal plane at cargo height `planeZ`, or, in
 * near-horizontal views (side view), on the vertical plane through cargo y = `centreY`.
 */
export function pointerToCargoPlane(raycaster: Raycaster, camera: Camera, ndc: Vector2, planeZ: number, centreY: number): { x: number; y: number } | null {
  raycaster.setFromCamera(ndc, camera);
  if (Math.abs(raycaster.ray.direction.y) > 0.2) {
    floorPlane.constant = -planeZ;
    if (!raycaster.ray.intersectPlane(floorPlane, hit)) return null;
    const c = threeToCargo(hit);
    return { x: c.x, y: c.y };
  }
  sidePlane.constant = -toThree(0, centreY, 0)[2];
  if (!raycaster.ray.intersectPlane(sidePlane, hit)) return null;
  return { x: threeToCargo(hit).x, y: centreY };
}

/**
 * Drag & drop of placed units on the cargo floor (snap, stack, validate, R rotates, Esc cancels).
 * Returns the pointer-down handler for cargo units (HTML5 drops live in DropController).
 */
export function useDragController(vehicle: Vehicle, draggable: boolean): (unitId: Id, e: ThreeEvent<PointerEvent>) => void {
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const connected = useThree((s) => s.events.connected) as HTMLElement | undefined;
  const session = useRef<Session | null>(null);
  const raycaster = useMemo(() => new Raycaster(), []);
  const vehicleRef = useRef(vehicle);
  vehicleRef.current = vehicle;
  const draggableRef = useRef(draggable);
  draggableRef.current = draggable;

  const toNdc = useCallback(
    (clientX: number, clientY: number, out: Vector2) => {
      const r = gl.domElement.getBoundingClientRect();
      return out.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    },
    [gl],
  );

  /** Pointer -> cargo x / y on the floor; in near-horizontal views a vertical plane through `centreY`. */
  const pointerToCargo = useCallback(
    (ndc: Vector2, centreY: number, planeZ = 0): { x: number; y: number } | null => pointerToCargoPlane(raycaster, get().camera, ndc, planeZ, centreY),
    [get, raycaster],
  );

  const end = useCallback(() => {
    session.current = null;
    interaction.dragging = false;
    syncControls();
  }, []);

  /** Recomputes the candidate from the latest pointer position and publishes it (once per frame). */
  const update = useCallback(() => {
    const s = session.current;
    if (!s || !s.started || !s.ctx || !s.origin || !s.spec) return;
    s.dirty = false;
    const p = pointerToCargo(s.ndc, s.centreY);
    if (!p) return;
    const centre = { x: p.x + s.grab.x, y: p.y + s.grab.y };
    const pos = dragCandidate(s.ctx, centre, orientedSize(s.spec.dims, s.orient));
    const store = useStore.getState();
    const prev = store.ui.drag;
    if (prev && prev.unitId === s.unitId && prev.ghost.orient === s.orient && prev.ghost.pos.x === pos.x && prev.ghost.pos.y === pos.y && prev.ghost.pos.z === pos.z) return;
    const ghost: Placement = { ...s.origin, pos, orient: s.orient };
    const check = validateMove(store.plan, ghost);
    s.centreY = pos.y + orientedSize(s.spec.dims, s.orient).y / 2;
    store.setDrag({ unitId: s.unitId, ghost, valid: check.ok, reasons: check.reasons, origin: s.origin });
  }, [pointerToCargo]);

  const cancel = useCallback(() => {
    if (session.current?.started) useStore.getState().setDrag(null);
    end();
  }, [end]);

  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const s = session.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      toNdc(ev.clientX, ev.clientY, s.ndc);
      if (!s.started) {
        if (!s.draggable || Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY) < DRAG_THRESHOLD_PX) return;
        const { plan } = useStore.getState();
        const origin = plan.placements[s.unitId];
        const unit = expandUnits(plan).find((u) => u.id === s.unitId);
        if (!origin || !unit || origin.vehicleId !== vehicleRef.current.id) {
          s.draggable = false;
          return;
        }
        const c = boxCenter(placementBox(origin, unit.spec));
        const startHit = pointerToCargo(toNdc(s.startX, s.startY, new Vector2()), c.y);
        s.started = true;
        s.ctx = dragContext(plan, origin.vehicleId, s.unitId);
        s.origin = origin;
        s.spec = unit.spec;
        s.orient = origin.orient;
        s.centreY = c.y;
        s.grab = startHit ? { x: c.x - startHit.x, y: c.y - startHit.y } : { x: 0, y: 0 };
      }
      s.dirty = true;
    };
    const onUp = (ev: PointerEvent) => {
      const s = session.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      const store = useStore.getState();
      if (!s.started) {
        store.select([s.unitId], s.additive ? 'toggle' : 'replace');
        end();
        return;
      }
      toNdc(ev.clientX, ev.clientY, s.ndc);
      update();
      const drag = useStore.getState().ui.drag;
      const origin = s.origin;
      if (drag && origin) {
        const moved = drag.ghost.orient !== origin.orient || drag.ghost.pos.x !== origin.pos.x || drag.ghost.pos.y !== origin.pos.y || drag.ghost.pos.z !== origin.pos.z;
        if (drag.valid && moved) store.moveUnit(s.unitId, drag.ghost.pos, drag.ghost.orient);
        else if (!drag.valid) store.toast(`Can't place ${s.spec?.name ?? 'unit'} here: ${drag.reasons[0] ?? 'blocked'}`, 'error');
      }
      store.setDrag(null);
      store.select([s.unitId], 'replace');
      end();
    };
    const onKey = (ev: KeyboardEvent) => {
      const s = session.current;
      if (!s?.started) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        cancel();
      } else if (ev.key === 'r' || ev.key === 'R') {
        ev.preventDefault();
        ev.stopPropagation();
        if (!s.spec) return;
        const options = allowedOrientations(s.spec);
        if (options.length < 2) {
          useStore.getState().toast(`${s.spec.name} must not be rotated`, 'error');
          return;
        }
        s.orient = options[(options.indexOf(s.orient) + 1) % options.length];
        s.dirty = true;
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [toNdc, pointerToCargo, update, end, cancel]);

  // Cancel a drag in progress if the scene unmounts (e.g. switching to the Plan view).
  useEffect(() => () => cancel(), [cancel]);

  useFrame(() => {
    if (session.current?.dirty) update();
  });

  return useCallback((unitId: Id, e: ThreeEvent<PointerEvent>) => {
    const ev = e.nativeEvent;
    session.current = {
      unitId,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      additive: ev.shiftKey || ev.ctrlKey || ev.metaKey,
      draggable: draggableRef.current,
      started: false,
      ctx: null,
      origin: null,
      spec: null,
      orient: 0,
      grab: { x: 0, y: 0 },
      centreY: 0,
      ndc: new Vector2(),
      dirty: false,
    };
    interaction.dragging = true;
    syncControls();
    // Keep receiving the pointer (and its release) even when it leaves the viewport.
    if (connected?.setPointerCapture) connected.setPointerCapture(ev.pointerId);
  }, [connected]);
}

export const ghostMaterials = {
  valid: new MeshBasicMaterial({ color: '#15803d', transparent: true, opacity: 0.22, depthWrite: false }),
  invalid: new MeshBasicMaterial({ color: '#c2261d', transparent: true, opacity: 0.28, depthWrite: false }),
};

/** Drag ghost: the unit at the candidate position inside a green/red hull, the origin outline and the reason. */
export function DragGhost({ spec, color }: { spec: ItemSpec; color: string }) {
  const drag = useStore((s) => s.ui.drag);
  const parts = useMemo(() => {
    if (!drag) return null;
    const box = placementBox(drag.ghost, spec);
    const c = boxCenter(box);
    const hullCentre = new Vector3();
    const hullSize = new Vector3();
    boxToThree(box, hullCentre, hullSize);
    hullSize.addScalar(0.06);
    return { box, position: toThree(c.x, c.y, box.min.z), hullCentre, hullSize };
  }, [drag, spec]);
  const orient = drag?.ghost.orient ?? 0;
  // Unit geometry relative to its footprint centre; only changes with the orientation.
  const local = useMemo(() => {
    const s = orientedSize(spec.dims, orient);
    return { min: { x: -s.x / 2, y: -s.y / 2, z: 0 }, max: { x: s.x / 2, y: s.y / 2, z: s.z } };
  }, [spec, orient]);
  const origin = drag?.origin ?? null;
  const originEdges = useMemo(() => {
    if (!origin) return null;
    const b = placementBox(origin, spec);
    return boxEdgePoints([b.min.x, b.min.y, b.min.z], [b.max.x, b.max.y, b.max.z]);
  }, [origin, spec]);
  if (!drag || !parts) return null;
  const { box } = parts;
  return (
    <group>
      <group position={parts.position}>
        <UnitMesh spec={spec} orient={orient} box={local} color={color} />
      </group>
      <mesh geometry={UNIT_BOX} material={drag.valid ? ghostMaterials.valid : ghostMaterials.invalid} position={parts.hullCentre} scale={parts.hullSize} />
      {originEdges && <CLines points={originEdges} />}
      {!drag.valid && (
        <SceneLabel position={toThree((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z + 0.15)} zIndex={45}>
          <div className="w-max max-w-72 -translate-x-1/2 -translate-y-full rounded-md bg-bad px-2 py-1 text-xs font-medium text-white shadow-card">{drag.reasons[0] ?? 'Not allowed here'}</div>
        </SceneLabel>
      )}
    </group>
  );
}
