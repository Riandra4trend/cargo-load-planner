import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Group } from 'three';
import { boxCenter, type Box } from '../domain/geometry';
import type { Id, Vehicle } from '../domain/types';
import type { LoadStep } from '../sim/sequence';
import { useStore } from '../state/store';
import type { CargoItem } from './CargoLayer';
import { setThree } from './coords';
import { Forklift } from './Forklift';
import type { DockLayout } from './staging';
import { UnitMesh } from './UnitMesh';

/** Seconds per forklift move at speed 1. */
const LOAD_STEP_S = 1.6;
/** Seconds for one stop's units to leave the vehicle at speed 1, and the pause before the next stop. */
const UNLOAD_STEP_S = 1.8;
const UNLOAD_HOLD_S = 0.6;
const FORK_TRAVEL_Z = 0.12;

export interface SimulationLayout {
  /** Units drawn by the instanced cargo layer (aboard, or waiting in the staging lanes). */
  items: CargoItem[];
  /** Load mode: the unit the forklift handles in the current step. */
  current: { item: CargoItem; slot: Box } | null;
  /** Unload mode: units leaving the vehicle at the current stop, with their lane slots. */
  leaving: { item: CargoItem; slot: Box }[];
}

/**
 * Splits the vehicle's units between the cargo layer and the animated set for the animation state.
 * Unload: units of stops in (unloadFrom, step] leave the vehicle; earlier stops are gone already.
 */
export function simulationLayout(
  vehicleItems: readonly CargoItem[],
  mode: 'idle' | 'load' | 'unload',
  step: number,
  sequence: readonly LoadStep[],
  dock: DockLayout,
  unloadFrom: number,
): SimulationLayout {
  if (mode === 'idle') return { items: vehicleItems as CargoItem[], current: null, leaving: [] };
  const items: CargoItem[] = [];
  const leaving: SimulationLayout['leaving'] = [];
  let current: SimulationLayout['current'] = null;
  if (mode === 'load') {
    const order = new Map<Id, number>(sequence.map((s, i) => [s.unitId, i]));
    for (const it of vehicleItems) {
      const i = order.get(it.unit.id) ?? -1;
      const slot = dock.slots.get(it.unit.id);
      if (i < step || !slot) items.push(it);
      else if (i === step) current = { item: it, slot };
      else items.push({ ...it, box: slot });
    }
  } else {
    for (const it of vehicleItems) {
      if (it.unit.stopSeq > step) items.push(it);
      else if (it.unit.stopSeq > unloadFrom) {
        const slot = dock.slots.get(it.unit.id);
        if (slot) leaving.push({ item: it, slot });
      }
    }
  }
  return { items, current, leaving };
}

interface P2 {
  x: number;
  y: number;
}

/** Arc-length parametrised polyline in the cargo x-y plane. */
class Path {
  readonly cum: number[] = [0];
  readonly total: number;
  constructor(readonly pts: P2[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    this.total = this.cum[this.cum.length - 1];
  }
  /** Point at fraction `t` of the length; returns the segment index and the fraction within it. */
  at(t: number, out: P2): { seg: number; f: number } {
    const d = Math.min(1, Math.max(0, t)) * this.total;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const len = this.cum[i] - this.cum[i - 1];
    const f = len > 1e-9 ? (d - this.cum[i - 1]) / len : 1;
    out.x = this.pts[i - 1].x + (this.pts[i].x - this.pts[i - 1].x) * f;
    out.y = this.pts[i - 1].y + (this.pts[i].y - this.pts[i - 1].y) * f;
    return { seg: i - 1, f };
  }
}

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Forklift pose: fork heel position (cargo x/y), heading (0 = forks toward -x) and fork height. */
interface ForkPose {
  x: number;
  y: number;
  heading: number;
  forkZ: number;
}

/**
 * Load at dock: the forklift picks the current step's unit from its staging lane (approaching from
 * the aisle, forks toward +x), reverses out, turns, drives through the rear doors and sets the unit
 * down at its planned position, then backs off. Advances `ui.animation.step` after each move.
 */
export function LoadSimulation({ dock, current, step, total, playing, speed, color, realistic }: {
  dock: DockLayout;
  current: SimulationLayout['current'];
  step: number;
  total: number;
  playing: boolean;
  speed: number;
  color: string | null;
  realistic: boolean;
}) {
  const rootRef = useRef<Group>(null);
  const carriageRef = useRef<Group>(null);
  const unitRef = useRef<Group>(null);
  const progress = useRef(0);
  const expectedStep = useRef(step);
  const last = useRef<ForkPose>({ x: dock.home.x, y: dock.home.y, heading: 0, forkZ: 0.02 });
  const pose = useRef<ForkPose>({ ...last.current });
  const scratch = useRef<P2>({ x: 0, y: 0 });

  // Manual jumps (step list, step buttons) restart the move from the parking spot.
  useLayoutEffect(() => {
    if (step === expectedStep.current) return;
    expectedStep.current = step;
    progress.current = 0;
    last.current = { x: dock.home.x, y: dock.home.y, heading: 0, forkZ: 0.02 };
  }, [step, dock]);

  const plan = useMemo(() => {
    if (!current) return null;
    const { slot } = current;
    const target = current.item.box;
    const s = boxCenter(slot);
    const t = boxCenter(target);
    const start = last.current;
    const aisleX = slot.min.x - 1.5;
    const pickup = { x: slot.min.x - 0.03, y: s.y };
    const approachPts: P2[] = [{ x: start.x, y: start.y }];
    if (start.x < dock.wallX + 0.5) approachPts.push({ x: dock.wallX + 1.3, y: start.y });
    approachPts.push({ x: aisleX, y: s.y }, pickup);
    const door = { x: dock.wallX + 1.0 + (target.max.x - target.min.x), y: t.y };
    const drop = { x: target.max.x + 0.03, y: t.y };
    return {
      approach: new Path(approachPts),
      carry: new Path([pickup, { x: aisleX, y: s.y }, door, drop]),
      startHeading: start.heading,
      startForkZ: start.forkZ,
      drop,
      dropZ: target.min.z,
      slot,
      target,
    };
    // `last` is read when the step's unit changes; it holds where the previous move ended.
  }, [current, dock]);

  useFrame((_, delta) => {
    const root = rootRef.current;
    const carriage = carriageRef.current;
    if (!root || !carriage) return;
    const p = pose.current;
    if (!plan) {
      Object.assign(p, last.current);
    } else {
      if (playing) progress.current = Math.min(1, progress.current + (delta * speed) / LOAD_STEP_S);
      const k = progress.current;
      const pt = scratch.current;
      if (k < 0.25) {
        const a = ease(k / 0.25);
        plan.approach.at(a, pt);
        p.x = pt.x;
        p.y = pt.y;
        p.heading = lerp(plan.startHeading, Math.PI, a);
        p.forkZ = lerp(plan.startForkZ, 0.02, a);
      } else if (k < 0.85) {
        const b = (k - 0.25) / 0.6;
        const { seg, f } = plan.carry.at(ease(b), pt);
        p.x = pt.x;
        p.y = pt.y;
        p.heading = seg === 0 ? Math.PI : seg === 1 ? lerp(Math.PI, 0, ease(f)) : 0;
        p.forkZ = seg < 2 ? lerp(0.02, FORK_TRAVEL_Z, clamp01(b / 0.12)) : lerp(FORK_TRAVEL_Z, plan.dropZ + 0.03, ease(f));
      } else {
        const c = (k - 0.85) / 0.15;
        p.heading = 0;
        p.forkZ = plan.dropZ + 0.03 * (1 - clamp01(c * 2));
        p.x = plan.drop.x + 0.7 * ease(clamp01(c * 2 - 1));
        p.y = plan.drop.y;
      }
    }
    setThree(root.position, p.x, p.y, 0);
    root.rotation.y = p.heading;
    carriage.position.y = p.forkZ;

    const unit = unitRef.current;
    if (unit && plan) {
      const k = progress.current;
      const sx = plan.target.max.x - plan.target.min.x;
      if (k < 0.25) {
        const s = boxCenter(plan.slot);
        setThree(unit.position, s.x, s.y, 0);
        unit.rotation.y = 0;
      } else if (k >= 0.925) {
        const t = boxCenter(plan.target);
        setThree(unit.position, t.x, t.y, plan.dropZ);
        unit.rotation.y = 0;
      } else {
        // Carried: unit centre sits on the forks, (sx / 2 + 0.03) ahead of the heel along the heading.
        const reach = sx / 2 + 0.03;
        setThree(unit.position, p.x - Math.cos(p.heading) * reach, p.y - Math.sin(p.heading) * reach, p.forkZ);
        unit.rotation.y = p.heading;
      }
    }

    if (plan && progress.current >= 1) {
      last.current = { x: p.x, y: p.y, heading: 0, forkZ: p.forkZ };
      progress.current = 0;
      expectedStep.current = step + 1;
      useStore.getState().setAnimation(step + 1 >= total ? { step: step + 1, playing: false } : { step: step + 1 });
    } else if (!plan && playing) {
      useStore.getState().setAnimation({ playing: false });
    }
  });

  const unitBox = useMemo(() => {
    if (!current) return null;
    const b = current.item.box;
    const hx = (b.max.x - b.min.x) / 2;
    const hy = (b.max.y - b.min.y) / 2;
    return { min: { x: -hx, y: -hy, z: 0 }, max: { x: hx, y: hy, z: b.max.z - b.min.z } };
  }, [current]);

  return (
    <group>
      <Forklift rootRef={rootRef} carriageRef={carriageRef} />
      {current && unitBox && color && (
        <group ref={unitRef}>
          <UnitMesh spec={current.item.unit.spec} orient={current.item.orient} box={unitBox} color={color} realistic={realistic} />
        </group>
      )}
    </group>
  );
}

/**
 * Unload: the units of the current stop slide out through the rear doors to their staging lane on
 * the dock and fade away. While playing, advances to the next stop after each stop has left.
 */
export function UnloadSimulation({ vehicle, leaving, step, maxStep, playing, speed, colors, realistic }: {
  vehicle: Vehicle;
  leaving: SimulationLayout['leaving'];
  step: number;
  maxStep: number;
  playing: boolean;
  speed: number;
  colors: ReadonlyMap<Id, string>;
  realistic: boolean;
}) {
  const elapsed = useRef(0);
  const advanced = useRef(false);
  const opacity = useRef(1);
  const groups = useRef(new Map<Id, Group>());
  const scratch = useRef<P2>({ x: 0, y: 0 });

  useLayoutEffect(() => {
    elapsed.current = 0;
    advanced.current = false;
    opacity.current = 1;
  }, [step]);
  useLayoutEffect(() => {
    if (playing) advanced.current = false;
  }, [playing]);

  const paths = useMemo(
    () =>
      leaving.map(({ item, slot }) => {
        const from = boxCenter(item.box);
        const to = boxCenter(slot);
        const out = { x: vehicle.cargo.l + 0.4 + (item.box.max.x - item.box.min.x) / 2, y: from.y };
        return { id: item.unit.id, path: new Path([from, out, to]), z0: item.box.min.z };
      }),
    [leaving, vehicle.cargo.l],
  );

  useFrame((_, delta) => {
    elapsed.current += delta * speed;
    const k = clamp01(elapsed.current / UNLOAD_STEP_S);
    const move = ease(clamp01(k / 0.75));
    opacity.current = 1 - clamp01((k - 0.75) / 0.25);
    const pt = scratch.current;
    for (const { id, path, z0 } of paths) {
      const g = groups.current.get(id);
      if (!g) continue;
      const { seg, f } = path.at(move, pt);
      setThree(g.position, pt.x, pt.y, seg === 0 ? z0 * (1 - f) : 0);
    }
    if (playing && !advanced.current && elapsed.current >= UNLOAD_STEP_S + UNLOAD_HOLD_S) {
      advanced.current = true;
      useStore.getState().setAnimation(step >= maxStep ? { playing: false } : { step: step + 1 });
    }
  });

  return (
    <group>
      {leaving.map(({ item }) => {
        const b = item.box;
        const hx = (b.max.x - b.min.x) / 2;
        const hy = (b.max.y - b.min.y) / 2;
        return (
          <group
            key={item.unit.id}
            ref={(g) => {
              if (g) groups.current.set(item.unit.id, g);
              else groups.current.delete(item.unit.id);
            }}
          >
            <UnitMesh spec={item.unit.spec} orient={item.orient} box={{ min: { x: -hx, y: -hy, z: 0 }, max: { x: hx, y: hy, z: b.max.z - b.min.z } }} color={colors.get(item.unit.id) ?? '#999'} opacityRef={opacity} realistic={realistic} />
          </group>
        );
      })}
    </group>
  );
}
