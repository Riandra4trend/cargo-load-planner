import { bulkCog, compartmentFill, compartmentOf, expandUnits, placementBox, placementCog } from '../domain/geometry';
import type { BayInfo, BridgeCheck, CargoUnit, CurvePoint, Id, Plan, StageResult, UnitStatus, Vehicle, Violation, AxleState } from '../domain/types';
import {
  bridgeFormulaChecks,
  computeStages,
  curvePeak,
  lateralImbalance,
  loadDistributionCurve,
  peakRunningMetreLoad,
  remainingCapacity,
  type Remaining,
  type StagePoint,
} from '../physics';
import { estimateFuel, type FuelEstimate } from '../physics/fuel';
import { checkPlan, type VehiclePhysics } from '../rules';

export interface FillInfo {
  /** Placed volume / usable volume. */
  volume: number;
  /** Cargo weight / rated payload. */
  weight: number;
  units: number;
  /** Rear-most occupied x, metres. */
  usedLength: number;
  /** EU loading metres: floor-level footprint / 2.4 m. */
  ldm: number;
  placedVolume: number;
  usableVolume: number;
}

export interface VehicleEval {
  vehicle: Vehicle;
  unitIds: Id[];
  points: StagePoint[];
  stages: StageResult[];
  /** Departure state (= stages[0].axle). */
  axle: AxleState;
  curve: CurvePoint[];
  peak: CurvePoint;
  remaining: Remaining;
  fill: FillInfo;
  bays: BayInfo[];
  lateral: number;
  cogHeight: number | null;
  bridge: BridgeCheck[];
  floorPeak: { x: number; kgPerM: number; ids: Id[] };
  /** Fuel for this vehicle's route with its cargo. */
  fuel: FuelEstimate;
  violations: Violation[];
}

export interface PlanEval {
  plan: Plan;
  units: CargoUnit[];
  unitById: Map<Id, CargoUnit>;
  byVehicle: Record<Id, VehicleEval>;
  violations: Violation[];
  violationsByUnit: Map<Id, Violation[]>;
  unplaced: CargoUnit[];
  status: Record<Id, UnitStatus>;
  /** Bay label ("B.03") containing each placed unit's COG. */
  bayOfUnit: Record<Id, string>;
  /** Orders = stops with cargo; loaded when every unit of the stop is placed. */
  orders: { loaded: number; total: number };
  /** Weight of all units, placed or not. */
  totalKg: number;
  /** Fuel over every vehicle in the plan. */
  fuel: { litres: number; cost: number; co2Kg: number };
}

const evalCache = new WeakMap<Plan, PlanEval>();
const curveCache = new WeakMap<Vehicle, CurvePoint[]>();

function bayLabel(i: number): string {
  return `B.${String(i + 1).padStart(2, '0')}`;
}

/** Full physics + rules evaluation of a plan. Pure and memoised per plan object. */
export function evaluatePlan(plan: Plan): PlanEval {
  const cached = evalCache.get(plan);
  if (cached) return cached;

  const units = expandUnits(plan);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const byVehicle: Record<Id, VehicleEval> = {};
  const physics: Record<Id, VehiclePhysics> = {};
  const bayOfUnit: Record<Id, string> = {};

  for (const v of plan.vehicles) {
    const placed = units.filter((u) => plan.placements[u.id]?.vehicleId === v.id);
    // Floor cargo has a box; bulk fills sit in a tank compartment or tipper body instead.
    const fills = placed.flatMap((u) => {
      const c = compartmentOf(v, plan.placements[u.id].compartmentId);
      return c ? [{ u, c }] : [];
    });
    const fillIds = new Set(fills.map((f) => f.u.id));
    const solid = placed.filter((u) => !fillIds.has(u.id));
    const boxes = solid.map((u) => placementBox(plan.placements[u.id], u.spec));
    const points: StagePoint[] = [
      ...solid.map((u) => {
        const c = placementCog(plan.placements[u.id], u.spec);
        return { id: u.id, x: c.x, y: c.y, z: c.z, kg: u.spec.weightKg, stopSeq: u.stopSeq };
      }),
      ...fills.map(({ u, c }) => {
        const g = bulkCog(v, c, u.spec);
        return { id: u.id, x: g.x, y: g.y, z: g.z, kg: u.spec.weightKg, stopSeq: u.stopSeq };
      }),
    ];
    const stages = computeStages(v, plan.stops, points, plan.settings.nearLimit);
    const axle = stages[0].axle;
    let curve = curveCache.get(v);
    if (!curve) {
      curve = loadDistributionCurve(v);
      curveCache.set(v, curve);
    }
    const bridge = v.bridgeFormula ? bridgeFormulaChecks(v, axle) : [];
    const floorPeak = peakRunningMetreLoad(
      solid.map((u, i) => ({ id: u.id, from: boxes[i].min.x, to: boxes[i].max.x, kg: u.spec.weightKg })),
      v.cargo.l,
    );
    const lateral = lateralImbalance(v, axle.cog);
    const cogHeight = axle.cog?.z ?? null;

    let fill: FillInfo;
    let bays: BayInfo[];
    if (v.bulk) {
      // Tankers and tippers: fill by volume, and the "bays" are the compartments (a tipper's body).
      const capacityL = v.bulk.compartments.reduce((sum, c) => sum + c.capacityL, 0);
      const litres = fills.reduce((sum, f) => sum + (f.u.spec.material?.volumeL ?? 0), 0);
      fill = {
        volume: capacityL > 0 ? litres / capacityL : 0,
        weight: axle.cargoKg / v.payloadKg,
        units: placed.length,
        usedLength: fills.reduce((m, f) => Math.max(m, f.c.toX), 0),
        ldm: 0,
        placedVolume: litres / 1000,
        usableVolume: capacityL / 1000,
      };
      bays = v.bulk.compartments.map((c, index) => {
        const inside = fills.filter((f) => f.c.id === c.id);
        return {
          index,
          label: c.label,
          fromX: c.fromX,
          toX: c.toX,
          kg: inside.reduce((sum, f) => sum + f.u.spec.weightKg, 0),
          fill: inside.reduce((sum, f) => sum + compartmentFill(f.u.spec, c), 0),
        };
      });
      for (const f of fills) bayOfUnit[f.u.id] = f.c.label;
    } else {
      const usableH = Math.max(0.01, v.cargo.h - v.airflowTopGap);
      const usableVolume = v.cargo.l * v.cargo.w * usableH;
      let placedVolume = 0;
      let usedLength = 0;
      let floorArea = 0;
      boxes.forEach((b) => {
        const vol = (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
        placedVolume += vol;
        usedLength = Math.max(usedLength, b.max.x);
        if (b.min.z < 0.01) floorArea += (b.max.x - b.min.x) * (b.max.y - b.min.y);
      });
      fill = { volume: placedVolume / usableVolume, weight: axle.cargoKg / v.payloadKg, units: placed.length, usedLength, ldm: floorArea / 2.4, placedVolume, usableVolume };

      const bayCount = Math.max(1, Math.ceil(v.cargo.l / v.bayLength - 1e-9));
      bays = Array.from({ length: bayCount }, (_, i) => {
        const fromX = i * v.bayLength;
        const toX = Math.min(v.cargo.l, (i + 1) * v.bayLength);
        let kg = 0;
        let vol = 0;
        solid.forEach((u, j) => {
          const b = boxes[j];
          const len = b.max.x - b.min.x;
          const overlap = Math.min(toX, b.max.x) - Math.max(fromX, b.min.x);
          if (overlap <= 0 || len <= 0) return;
          kg += (u.spec.weightKg * overlap) / len;
          vol += (b.max.y - b.min.y) * (b.max.z - b.min.z) * overlap;
        });
        return { index: i, label: bayLabel(i), fromX, toX, kg, fill: vol / ((toX - fromX) * v.cargo.w * usableH) };
      });
      points.forEach((p) => {
        bayOfUnit[p.id] = bayLabel(Math.min(bayCount - 1, Math.max(0, Math.floor(p.x / v.bayLength))));
      });
    }

    physics[v.id] = { vehicle: v, points, stages, bridge, floorPeak, lateral, cogHeight };
    byVehicle[v.id] = {
      vehicle: v,
      unitIds: placed.map((u) => u.id),
      points,
      stages,
      axle,
      curve,
      peak: curvePeak(curve),
      remaining: remainingCapacity(v, axle),
      fill,
      bays,
      lateral,
      cogHeight,
      bridge,
      floorPeak,
      fuel: estimateFuel(v, plan, placed.map((u) => ({ stopSeq: u.stopSeq, kg: u.spec.weightKg, cold: u.spec.temp !== 'ambient' }))),
      violations: [],
    };
  }

  const violations = checkPlan(plan, units, physics);
  const violationsByUnit = new Map<Id, Violation[]>();
  for (const vio of violations) {
    byVehicle[vio.vehicleId]?.violations.push(vio);
    for (const id of vio.unitIds) {
      const list = violationsByUnit.get(id);
      if (list) list.push(vio);
      else violationsByUnit.set(id, [vio]);
    }
  }

  const status: Record<Id, UnitStatus> = {};
  const unplaced: CargoUnit[] = [];
  let totalKg = 0;
  for (const u of units) {
    totalKg += u.spec.weightKg;
    if (!plan.placements[u.id]) {
      status[u.id] = 'unplaced';
      unplaced.push(u);
    } else if (violationsByUnit.has(u.id)) {
      status[u.id] = 'check';
    } else {
      status[u.id] = u.priority === 'urgent' ? 'urgent' : 'planned';
    }
  }

  const stopsWithCargo = new Map<Id, boolean>();
  for (const u of units) stopsWithCargo.set(u.stopId, (stopsWithCargo.get(u.stopId) ?? true) && !!plan.placements[u.id]);
  const orders = { loaded: [...stopsWithCargo.values()].filter(Boolean).length, total: stopsWithCargo.size };

  const fuel = { litres: 0, cost: 0, co2Kg: 0 };
  for (const ve of Object.values(byVehicle)) {
    fuel.litres += ve.fuel.totalL;
    fuel.cost += ve.fuel.cost;
    fuel.co2Kg += ve.fuel.co2Kg;
  }

  const result: PlanEval = { plan, units, unitById, byVehicle, violations, violationsByUnit, unplaced, status, bayOfUnit, orders, totalKg, fuel };
  evalCache.set(plan, result);
  return result;
}
