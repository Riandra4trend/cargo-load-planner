import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Raycaster, Vector2, Vector3 } from 'three';
import { templateById } from '../data/templates';
import { withMaterialVolume } from '../domain/materials';
import { allowedOrientations, expandUnits, isBulk, orientedSize, placementBox, type Box } from '../domain/geometry';
import type { Id, ItemSpec, ItemTemplate, Placement, Plan, Vehicle } from '../domain/types';
import { validateMove } from '../rules';
import { useStore } from '../state/store';
import { CARGO_TEMPLATE_MIME, CARGO_UNIT_MIME, isCargoDrag, type TemplateDragData } from '../ui/common/dragTypes';
import { addCargoToVehicle } from '../ui/data/placement';
import { boxToThree, toThree } from './coords';
import { ghostMaterials, pointerToCargoPlane } from './DragController';
import { dragCandidate, dragContext } from './dragMath';
import { SceneLabel } from './labels';
import { UNIT_BOX } from './materials';
import { compartmentAtX } from './tankMath';
import { UnitMesh } from './UnitMesh';

type DragPayload = { kind: 'unit'; unitId: Id } | ({ kind: 'template' } & TemplateDragData);

function readPayload(dt: DataTransfer): DragPayload | null {
  const unitId = dt.getData(CARGO_UNIT_MIME);
  if (unitId) return { kind: 'unit', unitId };
  const raw = dt.getData(CARGO_TEMPLATE_MIME);
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const { templateId, quantity, stopId, volumeL } = data as Record<string, unknown>;
    if (typeof templateId !== 'string') return null;
    const litres = Number(volumeL);
    return {
      kind: 'template',
      templateId,
      quantity: Math.max(1, Math.round(Number(quantity) || 1)),
      stopId: typeof stopId === 'string' ? stopId : '',
      volumeL: Number.isFinite(litres) && litres > 0 ? litres : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Payload of the HTML5 drag in progress. Browsers hide drag data during dragover, so it is captured
 * at dragstart (the window listener runs after the source's own handler has set the data).
 */
let activePayload: DragPayload | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('dragstart', (ev) => {
    activePayload = ev.dataTransfer ? readPayload(ev.dataTransfer) : null;
  });
  window.addEventListener('dragend', () => {
    activePayload = null;
  });
}

const accepts = (ev: DragEvent): boolean => isCargoDrag(ev.dataTransfer);

/** What is being dropped: its spec, the plan to validate against and its unit id there. */
interface DropSubject {
  spec: ItemSpec;
  plan: Plan;
  unitId: Id;
}

const TEMP_LINE = '__palette-drop';

/** For templates, a plan with a temporary line so validateMove can check unit #0 (with the palette's volume per unit). */
function subjectOf(p: DragPayload, plan: Plan, library: ItemTemplate[]): DropSubject | null {
  if (p.kind === 'unit') {
    const unit = expandUnits(plan).find((u) => u.id === p.unitId);
    return unit ? { spec: unit.spec, plan, unitId: unit.id } : null;
  }
  const template = templateById(p.templateId, library)?.spec;
  if (!template) return null;
  const spec = p.volumeL !== undefined && template.material ? withMaterialVolume(template, p.volumeL) : template;
  const stopId = plan.stops.some((s) => s.id === p.stopId) ? p.stopId : plan.stops[0]?.id;
  if (!stopId) return null;
  return { spec, unitId: `${TEMP_LINE}#0`, plan: { ...plan, lines: [...plan.lines, { id: TEMP_LINE, spec, quantity: 1, stopId, priority: 'normal' }] } };
}

type Candidate = { error: string } | { candidate: Placement; box: Box; ok: boolean; reason: string; label: string };

/** Candidate placement of the dragged subject under the pointer, validated against hard constraints. */
function candidateAt(subject: DropSubject, v: Vehicle, point: { x: number; y: number } | null): Candidate {
  const { spec, plan, unitId } = subject;
  const bulk = isBulk(spec);
  if (bulk !== !!v.bulk) {
    return {
      error: bulk
        ? `bulk ${spec.material?.state === 'solid' ? 'material needs a dump truck body' : 'liquid needs a tanker compartment'}`
        : `a ${v.bulk?.kind === 'tipper' ? 'dump truck' : 'tanker'} carries only bulk material`,
    };
  }
  if (!point || point.x < -1 || point.x > v.cargo.l + 1 || point.y < -1 || point.y > v.cargo.w + 1) {
    return { error: bulk ? `drop it onto ${v.bulk?.kind === 'tipper' ? 'the dump body' : 'a tank compartment'}` : 'drop it onto the cargo floor' };
  }
  if (bulk) {
    const c = compartmentAtX(v, point.x);
    if (!c) return { error: 'no compartment here' };
    const candidate: Placement = { unitId, vehicleId: v.id, compartmentId: c.id, pos: { x: c.fromX, y: 0, z: 0 }, orient: 0 };
    const check = validateMove(plan, candidate);
    return { candidate, box: { min: { x: c.fromX, y: 0, z: 0 }, max: { x: c.toX, y: v.cargo.w, z: v.cargo.h } }, ok: check.ok, reason: check.reasons[0] ?? '', label: c.label };
  }
  const ctx = dragContext(plan, v.id, unitId);
  if (!ctx) return { error: 'unknown vehicle' };
  const orient = allowedOrientations(spec)[0];
  const candidate: Placement = { unitId, vehicleId: v.id, pos: dragCandidate(ctx, point, orientedSize(spec.dims, orient)), orient };
  const check = validateMove(plan, candidate);
  return { candidate, box: placementBox(candidate, spec), ok: check.ok, reason: check.reasons[0] ?? '', label: '' };
}

/** Ghost shown while an HTML5 drag hovers the vehicle. */
export interface DropPreview {
  spec: ItemSpec;
  candidate: Placement;
  box: Box;
  ok: boolean;
  reason: string;
}

/**
 * HTML5 drops onto the viewport: unplaced units from the item table and templates from the cargo
 * palette. While dragging, returns the candidate ghost (snapped, stacked, validated); on drop places
 * the unit, or adds the template's line via addCargoToVehicle with the dropped spot for unit #0.
 */
export function useCargoDrops(vehicle: Vehicle, enabled: boolean): DropPreview | null {
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const connected = useThree((s) => s.events.connected) as HTMLElement | undefined;
  const raycaster = useMemo(() => new Raycaster(), []);
  const [preview, setPreview] = useState<DropPreview | null>(null);
  const pending = useRef<{ ndc: Vector2; dirty: boolean }>({ ndc: new Vector2(), dirty: false });
  const subjectCache = useRef<{ payload: DragPayload; plan: Plan; subject: DropSubject | null } | null>(null);
  const vehicleRef = useRef(vehicle);
  vehicleRef.current = vehicle;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const pointAt = (ndc: Vector2, bulk: boolean) => {
    const v = vehicleRef.current;
    return pointerToCargoPlane(raycaster, get().camera, ndc, bulk ? v.cargo.h / 2 : 0, v.cargo.w / 2);
  };
  const subjectFor = (payload: DragPayload): DropSubject | null => {
    const { plan, library } = useStore.getState();
    const c = subjectCache.current;
    if (c && c.payload === payload && c.plan === plan) return c.subject;
    const subject = subjectOf(payload, plan, library);
    subjectCache.current = { payload, plan, subject };
    return subject;
  };

  useFrame(() => {
    const p = pending.current;
    if (!p.dirty) return;
    p.dirty = false;
    const payload = activePayload;
    const subject = payload && enabledRef.current ? subjectFor(payload) : null;
    if (!subject) {
      setPreview(null);
      return;
    }
    const c = candidateAt(subject, vehicleRef.current, pointAt(p.ndc, isBulk(subject.spec)));
    if ('error' in c) {
      setPreview(null);
      return;
    }
    setPreview((prev) =>
      prev && prev.spec === subject.spec && prev.ok === c.ok && prev.candidate.compartmentId === c.candidate.compartmentId && prev.candidate.pos.x === c.candidate.pos.x && prev.candidate.pos.y === c.candidate.pos.y && prev.candidate.pos.z === c.candidate.pos.z
        ? prev
        : { spec: subject.spec, candidate: c.candidate, box: c.box, ok: c.ok, reason: c.reason },
    );
  });

  useEffect(() => {
    const target = connected ?? gl.domElement;
    const toNdc = (ev: DragEvent, out: Vector2) => {
      const r = gl.domElement.getBoundingClientRect();
      return out.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    };
    const onDragOver = (ev: DragEvent) => {
      if (!accepts(ev)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = ev.dataTransfer.types.includes(CARGO_TEMPLATE_MIME) ? 'copy' : 'move';
      toNdc(ev, pending.current.ndc);
      pending.current.dirty = true;
    };
    const onDragLeave = (ev: DragEvent) => {
      if (ev.relatedTarget instanceof Node && target.contains(ev.relatedTarget)) return;
      pending.current.dirty = false;
      setPreview(null);
    };
    const onDrop = (ev: DragEvent) => {
      if (!accepts(ev) || !ev.dataTransfer) return;
      ev.preventDefault();
      pending.current.dirty = false;
      setPreview(null);
      const store = useStore.getState();
      const payload = readPayload(ev.dataTransfer) ?? activePayload;
      if (!payload) return;
      if (!enabledRef.current) {
        store.toast('Finish the optimiser preview or the animation before adding cargo', 'error');
        return;
      }
      const subject = subjectOf(payload, store.plan, store.library);
      if (!subject) {
        store.toast(payload.kind === 'template' ? 'That cargo template is no longer available' : 'That unit is no longer in the plan', 'error');
        return;
      }
      const v = vehicleRef.current;
      const name = subject.spec.name;
      const c = candidateAt(subject, v, pointAt(toNdc(ev, new Vector2()), isBulk(subject.spec)));
      if ('error' in c) {
        store.toast(`Can't place ${name} here: ${c.error}`, 'error');
        return;
      }
      if (!c.ok) {
        store.toast(c.label ? `Can't fill ${c.label} with ${name}: ${c.reason || 'blocked'}` : `Can't place ${name} here: ${c.reason || 'blocked'}`, 'error');
        return;
      }
      if (payload.kind === 'unit') {
        if (c.candidate.compartmentId) store.assignCompartment(payload.unitId, v.id, c.candidate.compartmentId);
        else store.placeUnits([c.candidate], 'Place unit');
        store.select([payload.unitId], 'replace');
        return;
      }
      const stopId = subject.plan.lines[subject.plan.lines.length - 1].stopId;
      const result = addCargoToVehicle(subject.spec, payload.quantity, stopId, v.id, { first: { ...c.candidate, unitId: '' } });
      const after = useStore.getState();
      after.setHighlightLines([result.lineId]);
      if (result.placed.length) after.select([result.placed[0]], 'replace');
      after.toast(
        result.unplaced.length === 0
          ? `Added ${payload.quantity} × ${name} to ${v.name}`
          : `${result.placed.length} placed, ${result.unplaced.length} didn't fit: Optimise or add a vehicle`,
        result.unplaced.length === 0 ? 'success' : 'info',
      );
    };
    target.addEventListener('dragover', onDragOver);
    target.addEventListener('dragleave', onDragLeave);
    target.addEventListener('drop', onDrop);
    return () => {
      target.removeEventListener('dragover', onDragOver);
      target.removeEventListener('dragleave', onDragLeave);
      target.removeEventListener('drop', onDrop);
    };
    // pointAt / subjectFor only read refs and stable objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, gl]);

  return preview;
}

const hullCentre = new Vector3();
const hullSize = new Vector3();

/** Green / red ghost of a dragged unit or bulk fill, with the rejection reason. */
export function DropGhostView({ preview, color }: { preview: DropPreview | null; color: string }) {
  if (!preview) return null;
  const { box, spec, candidate, ok, reason } = preview;
  boxToThree(box, hullCentre, hullSize);
  const bulk = candidate.compartmentId !== undefined;
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const s = orientedSize(spec.dims, candidate.orient);
  return (
    <group>
      {!bulk && (
        <group position={toThree(cx, cy, box.min.z)}>
          <UnitMesh spec={spec} orient={candidate.orient} box={{ min: { x: -s.x / 2, y: -s.y / 2, z: 0 }, max: { x: s.x / 2, y: s.y / 2, z: s.z } }} color={color} />
        </group>
      )}
      <mesh geometry={UNIT_BOX} material={ok ? ghostMaterials.valid : ghostMaterials.invalid} position={[hullCentre.x, hullCentre.y, hullCentre.z]} scale={[hullSize.x + 0.06, hullSize.y + 0.06, hullSize.z + 0.06]} />
      {!ok && reason && (
        <SceneLabel position={toThree(cx, cy, box.max.z + 0.15)} zIndex={45}>
          <div className="w-max max-w-72 -translate-x-1/2 -translate-y-full rounded-md bg-bad px-2 py-1 text-xs font-medium text-white shadow-card">{reason}</div>
        </SceneLabel>
      )}
    </group>
  );
}
