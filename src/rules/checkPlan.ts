import { allowedOrientations, boxesOverlap, placementBox, placementCog } from '../domain/geometry';
import { bigLengthUnit, formatLength, formatPercent, formatWeight, lbToKg, M_PER_FT, toMetres } from '../domain/units';
import type { AxleLoad, BridgeCheck, CargoUnit, FixAction, Id, Plan, StageResult, Vehicle, Violation } from '../domain/types';
import { axleContributions, bestSliderPosition, computeAxleState, loadShares, withTrailerAxleX, type StagePoint } from '../physics';
import { overloaded, type Arrangement } from './arrangement';
import { planIndex, vehicleArrangement } from './context';
import { boxDistance, evaluateSupport, formatWeightRatio, hazmatIssue, localCheck, needsSupport } from './geometry';
import { searchPlacement } from './placement';
import { surgeViolations, tankAxleFixes, tankHardViolations } from './tankCheck';

/** Physics results the evaluation layer computes per vehicle before running the rules. */
export interface VehiclePhysics {
  vehicle: Vehicle;
  /** Mass points of the units placed in this vehicle (COG positions). */
  points: StagePoint[];
  /** stages[0] = departure, then after each stop. */
  stages: StageResult[];
  /** Empty unless vehicle.bridgeFormula. */
  bridge: BridgeCheck[];
  /** Highest concentrated floor load (1 m window), kg per running metre. */
  floorPeak: { x: number; kgPerM: number; ids: Id[] };
  /** Left/right cargo imbalance fraction at departure. */
  lateral: number;
  /** Cargo COG height above the floor at departure, metres (null when empty). */
  cogHeight: number | null;
}

/** Grid used for suggested moves, metres. */
const SNAP = 0.05;

type Fix = NonNullable<Violation['fix']>;

const pairKey = (a: Id, b: Id): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
const stageText = (stage: number): string => (stage === 0 ? 'at departure' : `after stop ${stage}`);

/**
 * All violations of a plan (hard and soft), with fix suggestions where possible. Units come from
 * the plan's memoised index (`expandUnits`), so `_units` only documents the evaluation contract.
 */
export function checkPlan(plan: Plan, _units: readonly CargoUnit[], physics: Readonly<Record<Id, VehiclePhysics>>): Violation[] {
  const out: Violation[] = [];
  for (const v of plan.vehicles) {
    const arr = vehicleArrangement(plan, v);
    vehicleHardViolations(plan, v, arr, true, out);
    const ph = physics[v.id];
    if (ph) softViolations(plan, v, ph, arr, out);
  }
  return out;
}

/**
 * Placement-related hard violations of the given vehicles (used by the optimiser's final check;
 * overfilled packaged containers are item data, not placement, and are left out).
 */
export function hardViolations(plan: Plan, vehicleIds: readonly Id[]): Violation[] {
  const out: Violation[] = [];
  for (const v of plan.vehicles) if (vehicleIds.includes(v.id)) vehicleHardViolations(plan, v, vehicleArrangement(plan, v), false, out);
  return out;
}

function vehicleHardViolations(plan: Plan, v: Vehicle, arr: Arrangement, containers: boolean, out: Violation[]): void {
  const s = plan.settings;
  const sys = s.units;
  const tol = s.overlapTolerance;
  const hard = (id: string, kind: Violation['kind'], message: string, unitIds: Id[]) =>
    out.push({ id, kind, severity: 'error', hard: true, message, vehicleId: v.id, unitIds });

  arr.solids.forEach((a, i) => {
    const spec = a.unit.spec;
    localCheck(spec, a.orient, a.box, v, s, (kind, message) => {
      const text = message();
      hard(`${kind}:${a.id}`, kind, `${a.label}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`, [a.id]);
      return false;
    });
    arr.near(a.box.min.x, a.box.max.x, (j) => {
      const b = arr.solids[j];
      if (j > i && boxesOverlap(a.box, b.box, tol)) hard(`overlap:${pairKey(a.id, b.id)}`, 'overlap', `${a.label} overlaps ${b.label}`, [a.id, b.id]);
    });
    if (needsSupport(a.box, tol)) {
      const sup = arr.supports[i];
      const ev = evaluateSupport(
        a.box,
        a.cog,
        sup.map((x) => arr.solids[x.idx].box),
      );
      const ids = [a.id, ...sup.map((x) => arr.solids[x.idx].id)];
      if (ev.fraction < s.supportRatio - 1e-9) {
        hard(`support:${a.id}`, 'support', `${a.label} is only ${formatPercent(ev.fraction)} supported (needs ${formatPercent(s.supportRatio)})`, ids);
      } else if (!ev.cogInside) {
        hard(`support:${a.id}`, 'support', `${a.label}: centre of gravity is not over the supporting units`, ids);
      }
    }
    for (const x of arr.supports[i]) {
      const b = arr.solids[x.idx];
      if (b.unit.spec.fragile) hard(`fragile:${a.id}:${b.id}`, 'fragile', `${a.label} rests on fragile ${b.label}`, [a.id, b.id]);
      else if (!b.unit.spec.stackable) hard(`stacking:on:${a.id}:${b.id}`, 'stacking', `${a.label} rests on ${b.label}, which is not stackable`, [a.id, b.id]);
    }
    if (spec.stackable && !spec.fragile && overloaded(spec, arr.load[i])) {
      hard(
        `stacking:load:${a.id}`,
        'stacking',
        `Load on ${a.label}: ${formatWeightRatio(arr.load[i], spec.maxLoadOnTopKg, sys)}`,
        [a.id, ...arr.dependents[i].map((j) => arr.solids[j].id)],
      );
    }
    if (arr.layer[i] > arr.cap[i]) {
      const by = arr.solids[arr.capBy[i]];
      const msg =
        by.id === a.id
          ? `${a.label} is in layer ${arr.layer[i]} but allows at most ${arr.cap[i]}`
          : `${a.label} is in layer ${arr.layer[i]}; ${by.label} allows at most ${arr.cap[i]}`;
      hard(`stacking:layers:${a.id}`, 'stacking', msg, by.id === a.id ? [a.id] : [a.id, by.id]);
    }
  });

  const haz = arr.hazmat;
  for (let x = 0; x < haz.length; x++) {
    for (let y = x + 1; y < haz.length; y++) {
      const a = arr.solids[haz[x]];
      const b = arr.solids[haz[y]];
      const d = boxDistance(a.box, b.box);
      const issue = hazmatIssue(s, a.unit.spec, b.unit.spec, d);
      if (!issue) continue;
      let msg: string;
      if (issue.rule === 'never') {
        msg = `${a.label} and ${b.label} must not travel together (hazmat classes ${a.unit.spec.hazmat?.hazClass} / ${b.unit.spec.hazmat?.hazClass})`;
      } else if (issue.rule === 'separate') {
        msg = `${a.label} and ${b.label} must be at least ${formatLength(issue.required, sys)} apart (${formatLength(d, sys)})`;
      } else {
        const [toxic, food] = issue.toxic === 'a' ? [a, b] : [b, a];
        msg = `${toxic.label} (class ${toxic.unit.spec.hazmat?.hazClass}) must be at least ${formatLength(issue.required, sys)} from food ${food.label}`;
      }
      hard(`hazmat:${pairKey(a.id, b.id)}`, 'hazmat', msg, [a.id, b.id]);
    }
  }
  tankHardViolations(plan, v, containers, out);
}

function softViolations(plan: Plan, v: Vehicle, ph: VehiclePhysics, arr: Arrangement, out: Violation[]): void {
  const s = plan.settings;
  const sys = s.units;
  const fw = (kg: number) => formatWeight(kg, sys);
  const soft = (vio: Omit<Violation, 'hard' | 'vehicleId'>): Violation => {
    const full: Violation = { ...vio, hard: false, vehicleId: v.id };
    out.push(full);
    return full;
  };

  const stagePoints = ph.stages.map((st) => {
    const aboard = new Set(st.unitIds);
    return ph.points.filter((p) => aboard.has(p.id));
  });

  const axleVios: { vio: Violation; group: number; axle: AxleLoad; stageIndex: number }[] = [];
  ph.stages.forEach((st, k) => {
    st.axle.axles.forEach((a, g) => {
      if (a.status === 'over') {
        const vio = soft({
          id: `axle-max:${v.id}:${a.id}:${st.stage}`,
          kind: 'axle-max',
          severity: 'error',
          message: `${a.label} over limit ${stageText(st.stage)}: ${formatWeightRatio(a.kg, a.maxKg, sys)}`,
          unitIds: axleContributions(v, stagePoints[k], g, 3).map((c) => c.id),
          stage: st.stage,
        });
        axleVios.push({ vio, group: g, axle: a, stageIndex: k });
      } else if (a.status === 'under') {
        const vio = soft({
          id: `axle-min:${v.id}:${a.id}:${st.stage}`,
          kind: 'axle-min',
          severity: 'error',
          message: `${a.label} below its minimum ${stageText(st.stage)}: ${formatWeightRatio(a.kg, a.minKg, sys)}`,
          unitIds: axleContributions(v, stagePoints[k], g, stagePoints[k].length)
            .slice(-3)
            .reverse()
            .map((c) => c.id),
          stage: st.stage,
        });
        axleVios.push({ vio, group: g, axle: a, stageIndex: k });
      }
    });
    if (st.axle.grossOver) {
      soft({
        id: `gross:${v.id}:${st.stage}`,
        kind: 'gross',
        severity: 'error',
        message: `Gross weight over limit ${stageText(st.stage)}: ${formatWeightRatio(st.axle.grossKg, v.grossLimitKg, sys)}`,
        unitIds: [],
        stage: st.stage,
      });
    }
  });
  const cargoKg = ph.stages[0]?.axle.cargoKg ?? 0;
  if (cargoKg > v.payloadKg + 0.5) {
    soft({ id: `payload:${v.id}`, kind: 'payload', severity: 'error', message: `Payload exceeded: ${formatWeightRatio(cargoKg, v.payloadKg, sys)}`, unitIds: [], stage: 0 });
  }
  for (const b of ph.bridge) {
    if (b.ok) continue;
    soft({
      id: `bridge:${v.id}:${b.label}`,
      kind: 'bridge',
      severity: 'error',
      message: `Bridge formula, ${b.label} over ${formatLength(b.lengthFt * M_PER_FT, sys, { big: true })}: ${formatWeightRatio(lbToKg(b.actualLb), lbToKg(b.allowedLb), sys)}`,
      unitIds: [],
      stage: 0,
    });
  }
  if (ph.floorPeak.kgPerM > v.floorKgPerM + 0.5) {
    const unit = bigLengthUnit(sys);
    const perLength = (kgPerM: number) => `${fw(kgPerM * toMetres(1, unit))}/${unit}`;
    soft({
      id: `floor-load:${v.id}`,
      kind: 'floor-load',
      severity: 'error',
      message: `Concentrated floor load at ${formatLength(ph.floorPeak.x, sys, { big: true })}: ${perLength(ph.floorPeak.kgPerM)} / ${perLength(v.floorKgPerM)}`,
      unitIds: [...ph.floorPeak.ids],
    });
  }
  if (ph.lateral > v.lateralMaxImbalance + 1e-9) {
    soft({
      id: `lateral:${v.id}`,
      kind: 'lateral',
      severity: 'warning',
      message: `Left/right imbalance ${formatPercent(ph.lateral)} (max ${formatPercent(v.lateralMaxImbalance)})`,
      unitIds: [],
      stage: 0,
    });
  }
  if (ph.cogHeight !== null && ph.cogHeight > v.maxCogHeight + 1e-9) {
    soft({
      id: `cog-height:${v.id}`,
      kind: 'cog-height',
      severity: 'warning',
      message: `Cargo centre of gravity ${formatLength(ph.cogHeight, sys)} above the floor (max ${formatLength(v.maxCogHeight, sys)})`,
      unitIds: [],
      stage: 0,
    });
  }
  for (const a of arr.solids) {
    if (a.kg > s.forkliftCapacityKg) {
      soft({
        id: `forklift:${a.id}`,
        kind: 'forklift',
        severity: 'warning',
        message: `${a.label} weighs ${fw(a.kg)}, above the forklift capacity (${fw(s.forkliftCapacityKg)})`,
        unitIds: [a.id],
      });
    }
  }

  let lifoFixes = 0;
  for (const [i, blocked] of arr.lifoPairs()) {
    const a = arr.solids[i];
    const earliest = Math.min(...blocked.map((j) => arr.solids[j].unit.stopSeq));
    const vio = soft({
      id: `lifo:${a.id}`,
      kind: 'lifo',
      severity: 'error',
      message: `${a.label} (stop ${a.unit.stopSeq}) blocks stop ${earliest}`,
      unitIds: [a.id, ...blocked.map((j) => arr.solids[j].id)],
    });
    if (lifoFixes < MAX_LIFO_FIXES) {
      lifoFixes++;
      const fix = lifoFix(plan, arr, i);
      if (fix) vio.fix = fix;
    }
  }

  surgeViolations(plan, v, out);
  if (axleVios.length && v.tank) {
    tankAxleFixes(
      plan,
      v,
      ph.points,
      axleVios.map((x) => x.vio),
    );
  } else if (axleVios.length) {
    axleFixes(plan, v, stagePoints, axleVios);
  }
}

/** Slider fix when one hole clears every axle violation at every stage, else per-violation unit moves. */
function axleFixes(plan: Plan, v: Vehicle, stagePoints: StagePoint[][], vios: { vio: Violation; group: number; axle: AxleLoad }[]): void {
  const s = plan.settings;
  if (v.statics.type === 'artic' && v.statics.slider) {
    const current = v.statics.trailerAxle.x;
    const best = bestSliderPosition(v, stagePoints, s.nearLimit);
    if (best && Math.abs(best.x - current) > 1e-6) {
      const moved = withTrailerAxleX(v, best.x);
      const clears = stagePoints.every((pts) => computeAxleState(moved, pts, s.nearLimit).axles.every((a) => a.status !== 'over' && a.status !== 'under'));
      if (clears) {
        const holes = Math.round(Math.abs(best.x - current) / v.statics.slider.step);
        const fix: Fix = {
          label: `Slide ${v.statics.trailerAxle.label.toLowerCase()} ${holes} hole${holes === 1 ? '' : 's'} ${best.x < current ? 'forward' : 'back'}`,
          action: { type: 'slider', vehicleId: v.id, x: best.x },
        };
        for (const { vio } of vios) vio.fix = fix;
        return;
      }
    }
  }
  // One move per axle group and direction, sized for the worst stage.
  const worst = new Map<string, { vios: Violation[]; group: number; isMax: boolean; need: number }>();
  for (const { vio, group, axle } of vios) {
    const isMax = vio.kind === 'axle-max';
    const need = isMax ? axle.kg - axle.maxKg : axle.minKg - axle.kg;
    const key = `${vio.kind}:${group}`;
    const entry = worst.get(key);
    if (!entry) worst.set(key, { vios: [vio], group, isMax, need });
    else {
      entry.vios.push(vio);
      entry.need = Math.max(entry.need, need);
    }
  }
  for (const { vios: list, group, isMax, need } of worst.values()) {
    const dShare = loadShares(v, 1)[group] - loadShares(v, 0)[group];
    if (Math.abs(dShare) < 1e-9) continue;
    const dir = isMax === dShare > 0 ? -1 : 1;
    const candidates = [...new Set(list.flatMap((x) => x.unitIds))];
    for (const unitId of candidates) {
      const fix = moveFix(plan, v, unitId, need, dir, Math.abs(dShare));
      if (!fix) continue;
      for (const vio of list) vio.fix = fix;
      break;
    }
  }
}

/** Steps searched on each side of the ideal position for a suggested move. */
const MOVE_SEARCH_STEPS = 60;
/** LIFO fix suggestions computed per vehicle and evaluation (each is a placement search). */
const MAX_LIFO_FIXES = 3;

/**
 * Moves a unit along x by the distance that shifts `need` kg off (or onto) an axle group, at the
 * legal position closest to that distance in the relieving direction (same y and z).
 */
function moveFix(plan: Plan, v: Vehicle, unitId: Id, need: number, dir: number, dShare: number): Fix | null {
  const { units, labels } = planIndex(plan);
  const p = plan.placements[unitId];
  const u = units.get(unitId);
  if (!p || !u || u.spec.weightKg <= 0 || p.vehicleId !== v.id) return null;
  const full = vehicleArrangement(plan, v);
  const self = full.solids.findIndex((s) => s.id === unitId);
  if (self < 0 || full.dependents[self].length > 0) return null;
  const arr = vehicleArrangement(plan, v, unitId);
  const dist = Math.max(SNAP, Math.ceil(need / (u.spec.weightKg * dShare) / SNAP - 1e-9) * SNAP);
  const target = p.pos.x + dir * dist;
  const len = placementBox(p, u.spec).max.x - p.pos.x;
  for (let k = 0; k <= MOVE_SEARCH_STEPS; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const x = Math.round((target + sign * dir * k * SNAP) * 1e6) / 1e6;
      const moveBy = (x - p.pos.x) * dir;
      if (moveBy < SNAP - 1e-9 || x < 0 || x + len > v.cargo.l) continue;
      const cand = { ...p, pos: { ...p.pos, x } };
      if (!arr.check(u, cand.orient, placementBox(cand, u.spec), placementCog(cand, u.spec), null)) continue;
      const action: FixAction = { type: 'move', unitId, pos: cand.pos };
      return { label: `Move ${labels.get(unitId) ?? u.spec.name} ${formatLength(moveBy, plan.settings.units, { big: true })} ${dir < 0 ? 'forward' : 'back'}`, action };
    }
  }
  return null;
}

/** A free legal spot nearer the front for a LIFO blocker where it blocks nothing, closest to where it is. */
function lifoFix(plan: Plan, full: Arrangement, i: number): Fix | undefined {
  if (full.dependents[i].length > 0) return undefined;
  const a = full.solids[i];
  const limit = a.box.min.x - plan.settings.overlapTolerance;
  // The blocker's current spot stays an obstacle: suggestions never overlap where it stands now.
  full.enableAnchors(0, [0]);
  const found = searchPlacement(full, a.unit, {
    orients: allowedOrientations(a.unit.spec),
    score: (c) =>
      c.lifo.length > 0 || c.sup.some((s) => s.idx === i)
        ? Infinity
        : Math.abs(c.pos.x - a.box.min.x) + Math.abs(c.pos.y - a.box.min.y) + Math.abs(c.pos.z - a.box.min.z),
    bound: (anchor) => (anchor.x >= limit ? Infinity : -Infinity),
  });
  if (!found) return undefined;
  const dx = a.box.min.x - found.cand.pos.x;
  return {
    label: `Move ${a.label} ${formatLength(dx, plan.settings.units, { big: true })} forward`,
    action: { type: 'move', unitId: a.id, pos: found.cand.pos, orient: found.cand.orient },
  };
}
