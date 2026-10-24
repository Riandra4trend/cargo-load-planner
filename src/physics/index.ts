import { maxFillPct } from '../domain/materials';
import { sliderPositions, vehicleTareKg } from '../domain/presets';
import { kgToLb, M_PER_FT } from '../domain/units';
import type { AxleGroup, AxleLoad, AxleState, AxleStatus, BridgeCheck, Compartment, CurvePoint, Id, MaterialContents, StageResult, Stop, Vec3, Vehicle } from '../domain/types';

/**
 * Vehicle statics. Every axle group's load is affine in the cargo: load_i = tare_i + Σ kg_j · share_i(x_j).
 *
 * Rigid: the two axle groups are supports. A load W at distance a behind the front axle with wheelbase L
 * puts W·a/L on the rear group and W − W·a/L on the front group (valid for a < 0 and a > L: cargo behind
 * the rear axle unloads the front axle).
 *
 * Articulated (two stages): trailer loads resolve onto the kingpin and the trailer axle group by moments
 * about the kingpin; the kingpin load then resolves onto the tractor's steer and drive groups from the
 * fifth-wheel position.
 */

export interface MassPoint {
  id: Id;
  x: number;
  y: number;
  z: number;
  kg: number;
}

export interface StagePoint extends MassPoint {
  stopSeq: number;
}

/** Load tolerance before a limit counts as broken, kg. */
const EPS_KG = 0.5;

/** Axle groups in a fixed order: rigid [front, rear]; articulated [steer, drive, trailer]. */
export function axleGroups(v: Vehicle): AxleGroup[] {
  const s = v.statics;
  return s.type === 'rigid' ? [s.front, s.rear] : [s.steer, s.drive, s.trailerAxle];
}

/** Fraction of a load at cargo position x carried by each axle group (order of axleGroups). May be negative. */
export function loadShares(v: Vehicle, x: number): number[] {
  const s = v.statics;
  if (s.type === 'rigid') {
    const rear = (x - s.front.x) / (s.rear.x - s.front.x);
    return [1 - rear, rear];
  }
  const trailer = (x - s.kingpinX) / (s.trailerAxle.x - s.kingpinX);
  const kingpin = 1 - trailer;
  const drive = (s.fifthWheelX - s.steer.x) / (s.drive.x - s.steer.x);
  return [kingpin * (1 - drive), kingpin * drive, trailer];
}

/** Axle group loads of the empty vehicle, kg (order of axleGroups). */
export function tareLoads(v: Vehicle): number[] {
  const s = v.statics;
  if (s.type === 'rigid') return [s.front.tareKg, s.rear.tareKg];
  const sh = loadShares(v, s.trailerTareX);
  return [s.steer.tareKg + s.trailerTareKg * sh[0], s.drive.tareKg + s.trailerTareKg * sh[1], s.trailerTareKg * sh[2]];
}

const STATUS_RANK: Record<AxleStatus, number> = { legal: 0, near: 1, under: 2, over: 3 };

function axleStatus(kg: number, maxKg: number, minKg: number, nearLimit: number): AxleStatus {
  if (kg > maxKg + EPS_KG) return 'over';
  if (kg < minKg - EPS_KG) return 'under';
  return kg >= nearLimit * maxKg ? 'near' : 'legal';
}

/** Axle loads, gross weight and cargo COG for a set of cargo mass points. */
export function computeAxleState(v: Vehicle, points: readonly MassPoint[], nearLimit = 0.9): AxleState {
  const groups = axleGroups(v);
  const loads = tareLoads(v);
  let cargoKg = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const p of points) {
    const sh = loadShares(v, p.x);
    for (let i = 0; i < loads.length; i++) loads[i] += p.kg * sh[i];
    cargoKg += p.kg;
    mx += p.kg * p.x;
    my += p.kg * p.y;
    mz += p.kg * p.z;
  }
  const grossKg = vehicleTareKg(v) + cargoKg;
  const axles: AxleLoad[] = groups.map((g, i) => {
    const minKg = (g.minShare ?? 0) * grossKg;
    return { id: g.id, label: g.label, kg: loads[i], maxKg: g.maxKg, minKg, ratio: loads[i] / g.maxKg, status: axleStatus(loads[i], g.maxKg, minKg, nearLimit) };
  });
  const grossOver = grossKg > v.grossLimitKg + EPS_KG;
  let status: AxleStatus = grossOver ? 'over' : 'legal';
  for (const a of axles) if (STATUS_RANK[a.status] > STATUS_RANK[status]) status = a.status;
  const state: AxleState = {
    axles,
    grossKg,
    cargoKg,
    cog: cargoKg > 0 ? { x: mx / cargoKg, y: my / cargoKg, z: mz / cargoKg } : null,
    status,
    grossOver,
  };
  if (v.statics.type === 'artic') state.kingpinKg = loads[0] - v.statics.steer.tareKg + loads[1] - v.statics.drive.tareKg;
  return state;
}

/** The cargo points contributing most to one axle group, largest first. */
export function axleContributions(v: Vehicle, points: readonly MassPoint[], groupIndex: number, limit = 5): { id: Id; kg: number }[] {
  return points
    .map((p) => ({ id: p.id, kg: p.kg * loadShares(v, p.x)[groupIndex] }))
    .sort((a, b) => b.kg - a.kg)
    .slice(0, limit);
}

/** Axle states at departure and after each stop (units removed in stop order; the empty final leg is omitted). */
export function computeStages(v: Vehicle, stops: readonly Stop[], points: readonly StagePoint[], nearLimit = 0.9): StageResult[] {
  const seqs = [...new Set(stops.map((s) => s.sequence))].sort((a, b) => a - b);
  const stage = (n: number, label: string, pts: readonly StagePoint[]): StageResult => ({
    stage: n,
    label,
    unitIds: pts.map((p) => p.id),
    axle: computeAxleState(v, pts, nearLimit),
  });
  const result = [stage(0, 'Depart', points)];
  for (const seq of seqs.slice(0, -1)) {
    result.push(stage(seq, `After ${seq}`, points.filter((p) => p.stopSeq > seq)));
  }
  return result;
}

/**
 * Load distribution diagram: for each cargo COG position along the floor, the maximum legal payload
 * considering every axle maximum, every axle minimum share, the rated payload and the gross limit.
 */
export function loadDistributionCurve(v: Vehicle, step = 0.05): CurvePoint[] {
  const groups = axleGroups(v);
  const tare = tareLoads(v);
  const tareKg = vehicleTareKg(v);
  const grossRoom = v.grossLimitKg - tareKg;
  const cap = Math.min(v.payloadKg, grossRoom);
  const capLabel = v.payloadKg <= grossRoom ? 'Payload' : 'Gross weight';
  const n = Math.max(1, Math.round(v.cargo.l / step));
  const curve: CurvePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const x = (v.cargo.l * i) / n;
    const sh = loadShares(v, x);
    let best = cap;
    let by = capLabel;
    groups.forEach((g, j) => {
      if (sh[j] > 1e-9) {
        const lim = (g.maxKg - tare[j]) / sh[j];
        if (lim < best) {
          best = lim;
          by = g.label;
        }
      }
      const m = g.minShare ?? 0;
      // tare_j + P·share_j >= m·(tare + P)  =>  P <= (tare_j − m·tare) / (m − share_j) when share_j < m
      if (m > 0 && sh[j] < m - 1e-9) {
        const lim = (tare[j] - m * tareKg) / (m - sh[j]);
        if (lim < best) {
          best = lim;
          by = `${g.label} minimum`;
        }
      }
    });
    curve.push({ x, maxKg: Math.max(0, best), limitedBy: by });
  }
  return curve;
}

/** Highest point of a load distribution curve. */
export function curvePeak(curve: readonly CurvePoint[]): CurvePoint {
  return curve.reduce((best, p) => (p.maxKg > best.maxKg ? p : best), curve[0]);
}

export interface Remaining {
  kg: number;
  /** Label of the binding constraint, e.g. "Rear axle", "Trailer tandem", "Payload", "Gross weight". */
  limitedBy: string;
}

/**
 * Extra weight that could still be added at cargo position `x` (default: the current cargo COG) before
 * the first limit is hit. When a limit is already broken the capacity is 0 and the worst broken limit is
 * named (overloaded group first, then the gross limit, then a minimum-share shortfall).
 */
export function remainingCapacity(v: Vehicle, state: AxleState, x: number = state.cog?.x ?? v.cargo.l / 2): Remaining {
  const over = state.axles.filter((a) => a.status === 'over').sort((a, b) => b.ratio - a.ratio)[0];
  if (over) return { kg: 0, limitedBy: over.label };
  if (state.grossOver) return { kg: 0, limitedBy: 'Gross weight' };
  const under = state.axles.find((a) => a.status === 'under');
  if (under) return { kg: 0, limitedBy: `${under.label} minimum` };
  const sh = loadShares(v, x);
  let best = v.payloadKg - state.cargoKg;
  let by = 'Payload';
  const grossRoom = v.grossLimitKg - state.grossKg;
  if (grossRoom < best) {
    best = grossRoom;
    by = 'Gross weight';
  }
  axleGroups(v).forEach((g, j) => {
    const load = state.axles[j].kg;
    if (sh[j] > 1e-9) {
      const lim = (g.maxKg - load) / sh[j];
      if (lim < best) {
        best = lim;
        by = g.label;
      }
    }
    const m = g.minShare ?? 0;
    if (m > 0 && sh[j] < m - 1e-9) {
      const lim = (load - m * state.grossKg) / (m - sh[j]);
      if (lim < best) {
        best = lim;
        by = `${g.label} minimum`;
      }
    }
  });
  return { kg: Math.max(0, best), limitedBy: by };
}

/**
 * Largest legal fill of a bulk compartment for a material: the volume whose weight can go at the
 * compartment centre on top of the other cargo (departure loads) without breaking a payload, gross or
 * axle limit, capped by the compartment capacity at the material's max fill. `limitedBy` names the
 * binding limit ("Capacity", "Payload", "Gross weight" or an axle group).
 */
export function maxLegalFill(v: Vehicle, others: readonly MassPoint[], c: Compartment, material: Pick<MaterialContents, 'materialId' | 'state' | 'densityKgPerL'>): { litres: number; limitedBy: string } {
  const capacityL = (c.capacityL * maxFillPct(material.materialId, material.state)) / 100;
  if (!(material.densityKgPerL > 0)) return { litres: capacityL, limitedBy: 'Capacity' };
  const room = remainingCapacity(v, computeAxleState(v, others), (c.fromX + c.toX) / 2);
  const byWeightL = room.kg / material.densityKgPerL;
  return byWeightL < capacityL ? { litres: byWeightL, limitedBy: room.limitedBy } : { litres: capacityL, limitedBy: 'Capacity' };
}

/** Left/right cargo imbalance as a fraction: 0 = centred, 1 = everything on one wall. */
export function lateralImbalance(v: Vehicle, cog: Vec3 | null): number {
  return cog ? Math.abs((2 * cog.y) / v.cargo.w - 1) : 0;
}

export interface AxlePosition {
  /** Metres along the vehicle (rigid: cargo frame; articulated: tractor frame, steer = 0). */
  pos: number;
  groupIndex: number;
}

/** Individual axle positions, front to rear. */
export function axlePositions(v: Vehicle): AxlePosition[] {
  const s = v.statics;
  const centres = s.type === 'rigid' ? [s.front.x, s.rear.x] : [s.steer.x, s.drive.x, s.fifthWheelX + (s.trailerAxle.x - s.kingpinX)];
  const groups = axleGroups(v);
  const out: AxlePosition[] = [];
  groups.forEach((g, gi) => {
    for (let i = 0; i < g.count; i++) {
      const pos = g.count === 1 ? centres[gi] : centres[gi] - g.spread / 2 + (i * g.spread) / (g.count - 1);
      out.push({ pos, groupIndex: gi });
    }
  });
  return out.sort((a, b) => a.pos - b.pos);
}

/** US Federal Bridge Formula W = 500·(LN/(N−1) + 12N + 36), rounded to the nearest 500 lb. */
export function bridgeAllowedLb(lengthFt: number, n: number): number {
  return Math.round((lengthFt * n) / (n - 1) + 12 * n + 36) * 500;
}

/**
 * Bridge Formula checks for every group of consecutive axles spanning at least two axle groups
 * (axles inside one group are governed by the group limit). Includes the exception that two
 * consecutive tandems may carry 34,000 lb each when their outer axles are at least 36 ft apart.
 */
export function bridgeFormulaChecks(v: Vehicle, state: AxleState): BridgeCheck[] {
  const groups = axleGroups(v);
  const axles = axlePositions(v).map((a) => ({ ...a, lb: kgToLb(state.axles[a.groupIndex].kg) / groups[a.groupIndex].count }));
  const checks: BridgeCheck[] = [];
  for (let i = 0; i < axles.length; i++) {
    for (let j = i + 1; j < axles.length; j++) {
      if (axles[i].groupIndex === axles[j].groupIndex) continue;
      const n = j - i + 1;
      const lengthFt = (axles[j].pos - axles[i].pos) / M_PER_FT;
      let allowedLb = bridgeAllowedLb(lengthFt, n);
      const span = axles.slice(i, j + 1);
      const spanGroups = [...new Set(span.map((a) => a.groupIndex))];
      const twoTandems = n === 4 && spanGroups.length === 2 && spanGroups.every((gi) => groups[gi].count === 2 && span.filter((a) => a.groupIndex === gi).length === 2);
      if (twoTandems && lengthFt >= 36) allowedLb = Math.max(allowedLb, 68_000);
      const actualLb = span.reduce((sum, a) => sum + a.lb, 0);
      checks.push({ label: `Axles ${i + 1}–${j + 1}`, n, lengthFt, allowedLb, actualLb, ok: actualLb <= allowedLb + 1 });
    }
  }
  return checks;
}

/** Copy of an articulated vehicle with the trailer axle group moved to x. */
export function withTrailerAxleX(v: Vehicle, x: number): Vehicle {
  if (v.statics.type !== 'artic') return v;
  return { ...v, statics: { ...v.statics, trailerAxle: { ...v.statics.trailerAxle, x } } };
}

/** Worst axle utilisation over several load states, plus a penalty for minimum-share shortfalls. */
function worstUtilisation(v: Vehicle, pointSets: readonly (readonly MassPoint[])[], nearLimit: number): number {
  let worst = 0;
  for (const pts of pointSets) {
    const st = computeAxleState(v, pts, nearLimit);
    for (const a of st.axles) {
      worst = Math.max(worst, a.kg / a.maxKg + (a.kg < a.minKg ? (a.minKg - a.kg) / a.maxKg : 0));
    }
  }
  return worst;
}

/**
 * Slider hole that minimises the worst axle utilisation over the given load states (e.g. departure
 * and after every stop). Ties go to the hole closest to the current position. Null without a slider.
 */
export function bestSliderPosition(
  v: Vehicle,
  pointSets: readonly (readonly MassPoint[])[],
  nearLimit = 0.9,
): { x: number; hole: number; worst: number } | null {
  const holes = sliderPositions(v);
  if (v.statics.type !== 'artic' || holes.length === 0) return null;
  const current = v.statics.trailerAxle.x;
  let best: { x: number; hole: number; worst: number } | null = null;
  holes.forEach((x, hole) => {
    const worst = worstUtilisation(withTrailerAxleX(v, x), pointSets, nearLimit);
    if (!best || worst < best.worst - 1e-9 || (Math.abs(worst - best.worst) <= 1e-9 && Math.abs(x - current) < Math.abs(best.x - current))) {
      best = { x, hole, worst };
    }
  });
  return best;
}

export interface Segment {
  id: Id;
  /** Extent along x, metres. */
  from: number;
  to: number;
  kg: number;
}

/**
 * Highest concentrated floor load: the 1 m window (sliding in `step` increments) carrying the most
 * weight, with each unit's weight spread evenly over its length. Returns kg per running metre.
 */
export function peakRunningMetreLoad(segments: readonly Segment[], length: number, window = 1, step = 0.05): { x: number; kgPerM: number; ids: Id[] } {
  let best = { x: 0, kgPerM: 0, ids: [] as Id[] };
  const n = Math.max(0, Math.ceil((length - window) / step));
  for (let i = 0; i <= n; i++) {
    const from = Math.min(i * step, Math.max(0, length - window));
    const to = from + window;
    let kg = 0;
    const ids: Id[] = [];
    for (const s of segments) {
      const overlap = Math.min(to, s.to) - Math.max(from, s.from);
      if (overlap <= 0) continue;
      kg += (s.kg * overlap) / Math.max(1e-6, s.to - s.from);
      ids.push(s.id);
    }
    if (kg / window > best.kgPerM) best = { x: from, kgPerM: kg / window, ids };
  }
  return best;
}
