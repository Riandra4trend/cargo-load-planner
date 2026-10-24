import { uid } from '../../domain/ids';
import { compartments, createVehicle, sliderPositions, vehicleTareKg } from '../../domain/presets';
import type { ArticStatics, AxleGroup, RigidStatics, TankCompartment, TankSpec, TempClass, TempZone, UnitSystem, Vehicle, VehicleKind } from '../../domain/types';
import { formatLength, formatLitres, formatMass } from '../../domain/units';
import { curvePeak, loadDistributionCurve } from '../../physics';

/** Pure helpers behind the vehicle editor: statics switching, temperature zones, tank compartments and validation. */

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Converts a vehicle between rigid and articulated statics with defaults scaled to its cargo length. */
export function withStaticsType(v: Vehicle, type: 'rigid' | 'artic'): Vehicle {
  if (v.statics.type === type) return v;
  const L = v.cargo.l;
  if (type === 'artic') {
    const template = createVehicle(v.region === 'US' ? 'us-dry-van-53' : 'eu-curtainsider-136');
    const ts = template.statics as ArticStatics;
    const axleX = round3(clamp(L - (template.cargo.l - ts.trailerAxle.x), Math.max(ts.kingpinX + 2, L * 0.55), Math.max(ts.kingpinX + 2, L - 0.6)));
    const shift = axleX - ts.trailerAxle.x;
    const statics: ArticStatics = {
      ...structuredClone(ts),
      trailerAxle: { ...ts.trailerAxle, x: axleX },
      trailerTareX: round3((L * ts.trailerTareX) / template.cargo.l),
    };
    if (ts.slider) statics.slider = { ...ts.slider, minX: ts.slider.minX + shift };
    else delete statics.slider;
    return {
      ...v,
      kind: v.kind === 'van' || v.kind === 'rigid' ? 'semi' : v.kind,
      grossLimitKg: template.grossLimitKg,
      payloadKg: template.payloadKg,
      fuel: { ...template.fuel, reeferLPerHour: v.fuel.reeferLPerHour },
      statics,
    };
  }
  const template = createVehicle(L < 5 ? 'eu-van-35' : 'eu-rigid-18');
  const ts = template.statics as RigidStatics;
  const statics: RigidStatics = {
    type: 'rigid',
    front: { ...ts.front },
    rear: { ...ts.rear, x: round3((L * ts.rear.x) / template.cargo.l) },
  };
  return {
    ...v,
    kind: v.kind === 'semi' || v.kind === 'container' ? 'rigid' : v.kind,
    grossLimitKg: template.grossLimitKg,
    payloadKg: template.payloadKg,
    fuel: { ...template.fuel, reeferLPerHour: v.fuel.reeferLPerHour },
    statics,
  };
}

// --- tank compartments --------------------------------------------------------

/** Share of the bounding box filled by an elliptical barrel cross-section. */
const BARREL_SECTION = Math.PI / 4;
/** New tanks hold this share of the barrel's geometric volume (walls, baffles, ullage). */
const DEFAULT_TANK_SHARE = 0.9;
const DEFAULT_COMPARTMENTS = 4;
const MIN_COMPARTMENT = 0.3;
const AUTO_LABEL = /^C\d+$/;

/** Geometric volume of `length` metres of the vehicle's barrel (elliptical section inside cargo w × h), litres. */
export function barrelLitres(v: Pick<Vehicle, 'cargo'>, length: number = v.cargo.l): number {
  return length * v.cargo.w * v.cargo.h * BARREL_SECTION * 1000;
}

/** A new tank: equal compartments holding about 90 % of the barrel volume, rounded down to 100 L each. */
export function defaultTank(v: Vehicle): TankSpec {
  const each = Math.max(100, Math.floor((barrelLitres(v) * DEFAULT_TANK_SHARE) / DEFAULT_COMPARTMENTS / 100) * 100);
  return {
    compartments: compartments(v.cargo.l, Array.from({ length: DEFAULT_COMPARTMENTS }, () => each)),
    baffled: false,
    foodGrade: false,
    insulated: false,
    pressurised: false,
  };
}

/** Changes the body type; becoming a tanker creates a default tank, leaving it removes the tank. */
export function withKind(v: Vehicle, kind: VehicleKind): Vehicle {
  if (kind === v.kind) return v;
  if (kind === 'tanker') return { ...v, kind, tank: v.tank ?? defaultTank(v) };
  const next = { ...v, kind };
  delete next.tank;
  return next;
}

/** Positions compartments along 0..L in proportion to their capacities (ids, labels and capacities kept). */
export function layoutCompartments(list: TankCompartment[], L: number): TankCompartment[] {
  const weights = list.map((c) => (c.capacityL > 0 ? c.capacityL : 0));
  const laid = compartments(L, weights.some((w) => w > 0) ? weights : weights.map(() => 1));
  return list.map((c, i) => ({ ...c, fromX: laid[i].fromX, toX: laid[i].toX }));
}

/** True when the compartments sit exactly where layoutCompartments would put them. */
export function isAutoLayout(list: TankCompartment[], L: number): boolean {
  const laid = layoutCompartments(list, L);
  return list.every((c, i) => Math.abs(c.fromX - laid[i].fromX) < 0.001 && Math.abs(c.toX - laid[i].toX) < 0.001);
}

/** Renumbers C1..Cn front to rear unless the user has given custom labels. */
function relabel(list: TankCompartment[]): TankCompartment[] {
  return list.every((c) => AUTO_LABEL.test(c.label)) ? list.map((c, i) => ({ ...c, label: `C${i + 1}` })) : list;
}

/** Rebuilds contiguous positions from each compartment's current length, in list order, scaled to L. */
function restack(list: TankCompartment[], L: number): TankCompartment[] {
  const total = list.reduce((sum, c) => sum + (c.toX - c.fromX), 0);
  let x = 0;
  return list.map((c, i) => {
    const fromX = x;
    x = i === list.length - 1 ? L : round3(x + ((c.toX - c.fromX) * L) / (total || 1));
    return { ...c, fromX, toX: x };
  });
}

/** Adds a bulkhead: the largest compartment is split into two halves (capacity and length). */
export function splitCompartment(list: TankCompartment[], L: number, auto: boolean): TankCompartment[] {
  if (!list.length) return [{ id: uid('comp'), label: 'C1', fromX: 0, toX: L, capacityL: 1000 }];
  const i = list.reduce((best, c, j) => (c.capacityL > list[best].capacityL ? j : best), 0);
  const c = list[i];
  const mid = round3((c.fromX + c.toX) / 2);
  const half = Math.round(c.capacityL / 2);
  const used = new Set(list.map((x) => x.label));
  let n = list.length + 1;
  while (used.has(`C${n}`)) n++;
  const next = [...list];
  next.splice(i, 1, { ...c, toX: mid, capacityL: c.capacityL - half }, { id: uid('comp'), label: `C${n}`, fromX: mid, toX: c.toX, capacityL: half });
  const labelled = relabel(next);
  return auto ? layoutCompartments(labelled, L) : labelled;
}

/** Removes the bulkhead behind compartment i (or in front of the last one): its space and capacity merge into the neighbour. */
export function mergeCompartment(list: TankCompartment[], i: number, L: number, auto: boolean): TankCompartment[] {
  if (list.length <= 1) return list;
  const into = i === 0 ? 1 : i - 1;
  const removed = list[i];
  const next = list
    .map((c, j) => (j === into ? { ...c, fromX: Math.min(c.fromX, removed.fromX), toX: Math.max(c.toX, removed.toX), capacityL: c.capacityL + removed.capacityL } : c))
    .filter((_, j) => j !== i);
  const labelled = relabel(next);
  return auto ? layoutCompartments(labelled, L) : labelled;
}

/** Moves compartment i one place toward the front (-1) or rear (+1), keeping each compartment's length. */
export function moveCompartment(list: TankCompartment[], i: number, dir: -1 | 1, L: number, auto: boolean): TankCompartment[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  const labelled = relabel(next);
  return auto ? layoutCompartments(labelled, L) : restack(labelled, L);
}

/** Manual layout: moves the bulkhead between compartments i and i + 1 to x (kept inside both neighbours). */
export function moveTankBulkhead(list: TankCompartment[], i: number, x: number): TankCompartment[] {
  const a = list[i];
  const b = list[i + 1];
  if (!a || !b) return list;
  const at = round3(clamp(x, a.fromX + MIN_COMPARTMENT, b.toX - MIN_COMPARTMENT));
  return list.map((c, j) => (j === i ? { ...c, toX: at } : j === i + 1 ? { ...c, fromX: at } : c));
}

/** Fits compartments to a new barrel length: re-laid by capacity (auto) or scaled proportionally (manual). */
export function fitCompartments(list: TankCompartment[], L: number, auto: boolean): TankCompartment[] {
  return auto ? layoutCompartments(list, L) : restack(list, L);
}

// --- temperature zones --------------------------------------------------------

/** Rebuilds contiguous zones over 0..L from temps and inner bulkhead positions (sorted). */
function rebuildZones(zones: TempZone[], inner: number[], L: number): TempZone[] {
  const cuts = [0, ...[...inner].sort((a, b) => a - b), L];
  return zones.map((z, i) => ({ ...z, fromX: round3(cuts[i]), toX: round3(cuts[i + 1]) }));
}

const innerCuts = (zones: TempZone[]) => zones.slice(0, -1).map((z) => z.toX);

/** Moves bulkhead `i` (between zone i and i + 1) to x; positions are re-sorted so zones stay contiguous. */
export function moveBulkhead(zones: TempZone[], i: number, x: number, L: number): TempZone[] {
  const inner = innerCuts(zones);
  inner[i] = clamp(x, 0, L);
  return rebuildZones(zones, inner, L);
}

/** Scales zones to a new cargo length, keeping their proportions. */
export function scaleZones(zones: TempZone[], oldL: number, L: number): TempZone[] {
  if (oldL <= 0 || L <= 0) return zones;
  return rebuildZones(zones, innerCuts(zones).map((x) => (x * L) / oldL), L);
}

/** Splits the longest zone in two; the new rear half gets `temp`. */
export function addZone(zones: TempZone[], L: number, temp: TempClass = 'ambient'): TempZone[] {
  const longest = zones.reduce((best, z, i) => (z.toX - z.fromX > zones[best].toX - zones[best].fromX ? i : best), 0);
  const z = zones[longest];
  const mid = round3((z.fromX + z.toX) / 2);
  const next = [...zones];
  next.splice(longest, 1, { ...z, toX: mid }, { id: uid('zone'), temp, fromX: mid, toX: z.toX });
  return rebuildZones(next, innerCuts(next), L);
}

/** Removes zone i; its neighbour takes over the space. */
export function removeZone(zones: TempZone[], i: number, L: number): TempZone[] {
  if (zones.length <= 1) return zones;
  const next = zones.filter((_, j) => j !== i);
  const inner = innerCuts(zones).filter((_, j) => j !== (i === 0 ? 0 : i - 1));
  return rebuildZones(next, inner, L);
}

// --- validation ---------------------------------------------------------------

export interface VehicleIssue {
  level: 'error' | 'warning';
  message: string;
}

const MIN_ZONE = 0.1;

function checkGroup(g: AxleGroup, issues: VehicleIssue[], sys: UnitSystem) {
  const err = (message: string) => issues.push({ level: 'error', message: `${g.label || 'Axle group'}: ${message}` });
  if (!(g.maxKg > 0)) err('maximum load must be greater than 0');
  if (g.tareKg < 0) err('tare load must not be negative');
  if (!Number.isInteger(g.count) || g.count < 1 || g.count > 4) err('number of axles must be 1 to 4');
  if (g.spread < 0) err('axle spread must not be negative');
  if (g.count > 1 && g.spread <= 0) err('a multi-axle group needs a spread greater than 0');
  if (g.count === 1 && g.spread > 0) issues.push({ level: 'warning', message: `${g.label}: spread ${formatLength(g.spread, sys, { big: true })} is ignored for a single axle` });
  if (g.minShare !== undefined && (g.minShare < 0 || g.minShare >= 0.9)) err('minimum share must be between 0 and 90 %');
}

/** Errors block saving; warnings are advisory. */
export function validateVehicle(v: Vehicle, sys: UnitSystem): VehicleIssue[] {
  const issues: VehicleIssue[] = [];
  const err = (message: string) => issues.push({ level: 'error', message });
  const warn = (message: string) => issues.push({ level: 'warning', message });
  const len = (m: number) => formatLength(m, sys, { big: true });
  const L = v.cargo.l;

  if (!v.name.trim()) err('Name is required');
  if (!(v.cargo.l > 0 && v.cargo.w > 0 && v.cargo.h > 0)) err('Cargo length, width and height must be greater than 0');
  if (!(v.door.w > 0 && v.door.h > 0)) err('Door width and height must be greater than 0');
  if (v.door.w > v.cargo.w + 0.01 || v.door.h > v.cargo.h + 0.01) warn('The door is larger than the cargo space; units are limited by the cargo space anyway');
  if (!v.access.length) err('Choose at least one access side');
  if (!(v.grossLimitKg > 0)) err('Gross limit must be greater than 0');
  if (!(v.payloadKg > 0)) err('Payload must be greater than 0');
  if (!(v.floorKgPerM > 0)) err('Floor rating must be greater than 0');
  if (!(v.maxCogHeight > 0)) err('Max COG height must be greater than 0');
  if (!(v.bayLength > 0)) err('Bay length must be greater than 0');
  if (v.deckHeight < 0) err('Deck height must not be negative');
  if (v.airflowTopGap < 0 || v.airflowTopGap >= v.cargo.h) err('Airflow gap must be between 0 and the cargo height');
  if (!(v.lateralMaxImbalance > 0 && v.lateralMaxImbalance <= 1)) err('Lateral imbalance limit must be between 0 and 100 %');

  const f = v.fuel;
  if (!(f.emptyLPer100km > 0 && f.fullLPer100km > 0)) err('Fuel consumption must be greater than 0');
  else if (f.fullLPer100km < f.emptyLPer100km) warn('Consumption at full payload is lower than empty');
  if (f.idleLPerHour < 0 || f.reeferLPerHour < 0) err('Idle and reefer fuel use must not be negative');
  if (!(f.tankL > 0)) err('Fuel tank capacity must be greater than 0');
  if (v.tempControlled && f.reeferLPerHour === 0) warn('Temperature controlled, but the reefer unit uses no fuel');

  const tare = vehicleTareKg(v);
  if (tare >= v.grossLimitKg) err(`Tare ${formatMass(tare, sys)} is not below the gross limit ${formatMass(v.grossLimitKg, sys)}`);
  else if (v.payloadKg > v.grossLimitKg - tare + 1) warn(`Rated payload exceeds the room under the gross limit (${formatMass(v.grossLimitKg - tare, sys)}); the gross limit governs`);

  const s = v.statics;
  if (s.type === 'rigid') {
    checkGroup(s.front, issues, sys);
    checkGroup(s.rear, issues, sys);
    if (!(s.rear.x - s.front.x > 0.5)) err('Wheelbase must be positive: the rear axle must be behind the front axle');
  } else {
    checkGroup(s.steer, issues, sys);
    checkGroup(s.drive, issues, sys);
    checkGroup(s.trailerAxle, issues, sys);
    if (!(s.drive.x > s.steer.x)) err('Tractor wheelbase must be positive: the drive axle must be behind the steer axle');
    if (!(s.fifthWheelX > s.steer.x)) err('The fifth wheel must be behind the steer axle');
    else if (s.fifthWheelX > s.drive.x + s.drive.spread / 2) warn('The fifth wheel is behind the drive axle, which unloads the steer axle');
    if (s.kingpinX < 0 || s.kingpinX >= L) err(`Kingpin must lie within the cargo length (0 to ${len(L)})`);
    if (!(s.trailerAxle.x > s.kingpinX + 0.5)) err('The kingpin must be ahead of the trailer axle group');
    if (s.trailerTareKg < 0) err('Trailer tare must not be negative');
    if (s.trailerTareX < 0 || s.trailerTareX > L) warn('Trailer tare COG lies outside the cargo length');
    if (s.slider) {
      const { minX, step, holes } = s.slider;
      if (!(step > 0)) err('Slider hole spacing must be greater than 0');
      if (!Number.isInteger(holes) || holes < 2) err('A sliding tandem needs at least 2 holes');
      if (!(minX > s.kingpinX + 0.5)) err('The foremost slider hole must be behind the kingpin');
      if (step > 0 && holes >= 2) {
        if (minX + (holes - 1) * step > L + 1) warn('The rearmost slider hole is more than 1 m behind the cargo space');
        if (!sliderPositions(v).some((x) => Math.abs(x - s.trailerAxle.x) < 0.001)) warn('The trailer axle is not on a slider hole');
      }
    }
  }

  // temperature zones
  const zones = v.zones;
  if (!zones.length) err('At least one temperature zone is required');
  else {
    if (Math.abs(zones[0].fromX) > 0.001 || Math.abs(zones[zones.length - 1].toX - L) > 0.001) err(`Temperature zones must cover the full cargo length (0 to ${len(L)})`);
    zones.forEach((z, i) => {
      if (i > 0 && Math.abs(z.fromX - zones[i - 1].toX) > 0.001) err('Temperature zones must be contiguous');
      if (z.toX - z.fromX < MIN_ZONE) err(`Zone ${i + 1} must be at least ${len(MIN_ZONE)} long`);
    });
    if (!v.tempControlled && zones.some((z) => z.temp !== 'ambient')) err('Only temperature-controlled vehicles can have chilled or frozen zones');
  }

  // tank
  if (v.kind === 'tanker') {
    const list = v.tank?.compartments ?? [];
    const litres = (l: number) => formatLitres(l, sys, 0);
    if (!list.length) err('A tanker needs at least one tank compartment');
    else {
      if (Math.abs(list[0].fromX) > 0.001 || Math.abs(list[list.length - 1].toX - L) > 0.001) err(`Compartments must cover the full tank length (0 to ${len(L)})`);
      list.forEach((c, i) => {
        const name = c.label.trim() || `Compartment ${i + 1}`;
        if (i > 0 && Math.abs(c.fromX - list[i - 1].toX) > 0.001) err('Compartments must be contiguous');
        if (c.toX - c.fromX < MIN_COMPARTMENT - 0.0005) err(`${name} must be at least ${len(MIN_COMPARTMENT)} long`);
        if (!(c.capacityL > 0)) err(`${name}: capacity must be greater than 0`);
        else if (c.toX > c.fromX) {
          const room = barrelLitres(v, c.toX - c.fromX);
          if (c.capacityL > room * 1.001) err(`${name}: ${litres(c.capacityL)} does not fit in ${len(c.toX - c.fromX)} of barrel (geometric volume ${litres(room)})`);
        }
      });
      const labels = list.map((c) => c.label.trim());
      if (labels.some((x) => !x) || new Set(labels).size !== labels.length) err('Compartment labels must be unique and not empty');
      const totalL = list.reduce((sum, c) => sum + c.capacityL, 0);
      // Water (1 kg/L) is the common reference; heavier liquids (acids, molasses) reach the payload sooner.
      if (totalL > v.payloadKg + 0.5) warn(`A full load of water (${litres(totalL)} = ${formatMass(totalL, sys)}) exceeds the payload ${formatMass(v.payloadKg, sys)}; part-fill the compartments`);
    }
  }

  if (!issues.some((i) => i.level === 'error')) {
    const peak = curvePeak(loadDistributionCurve(v));
    if (!(peak.maxKg > 0)) err('No legal payload at any COG position: check axle positions, limits and tare loads');
  }
  return issues;
}
