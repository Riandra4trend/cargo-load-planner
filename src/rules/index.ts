/**
 * Rules engine contract (owned by the engine slice; this interim version only covers axle, gross,
 * payload, bounds and overlap checks and will be replaced by the full implementation).
 */
import { boxesOverlap, placementBox } from '../domain/geometry';
import type { BridgeCheck, CargoUnit, Id, Placement, Plan, StageResult, Vehicle, Violation } from '../domain/types';
import { axleContributions, type StagePoint } from '../physics';

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

/** All violations of a plan (hard and soft), with fix suggestions where possible. */
export function checkPlan(plan: Plan, units: readonly CargoUnit[], physics: Readonly<Record<Id, VehiclePhysics>>): Violation[] {
  const out: Violation[] = [];
  for (const { vehicle: v, stages, points } of Object.values(physics)) {
    for (const st of stages) {
      const aboard = new Set(st.unitIds);
      st.axle.axles.forEach((a, groupIndex) => {
        if (a.status === 'over') {
          out.push({
            id: `axle-max:${v.id}:${a.id}:${st.stage}`,
            kind: 'axle-max',
            severity: 'error',
            hard: false,
            message: `${a.label} over limit ${st.stage === 0 ? 'at departure' : st.label.toLowerCase()}: ${Math.round(a.kg)} / ${Math.round(a.maxKg)} kg`,
            vehicleId: v.id,
            unitIds: axleContributions(v, points.filter((p) => aboard.has(p.id)), groupIndex, 3).map((c) => c.id),
            stage: st.stage,
          });
        }
      });
      if (st.axle.grossOver) {
        out.push({ id: `gross:${v.id}:${st.stage}`, kind: 'gross', severity: 'error', hard: false, message: `Gross weight over limit: ${Math.round(st.axle.grossKg)} / ${Math.round(v.grossLimitKg)} kg`, vehicleId: v.id, unitIds: [], stage: st.stage });
      }
    }
    const cargo = stages[0]?.axle.cargoKg ?? 0;
    if (cargo > v.payloadKg + 0.5) {
      out.push({ id: `payload:${v.id}`, kind: 'payload', severity: 'error', hard: false, message: `Payload exceeded: ${Math.round(cargo)} / ${Math.round(v.payloadKg)} kg`, vehicleId: v.id, unitIds: [], stage: 0 });
    }
  }
  const byId = new Map(units.map((u) => [u.id, u]));
  const placed = Object.values(plan.placements);
  for (const p of placed) {
    const u = byId.get(p.unitId);
    const v = plan.vehicles.find((x) => x.id === p.vehicleId);
    if (!u || !v) continue;
    const reasons = hardReasons(plan, p, u, v);
    if (reasons.length) out.push({ id: `bounds:${p.unitId}`, kind: 'bounds', severity: 'error', hard: true, message: `${u.spec.name}: ${reasons.join('; ')}`, vehicleId: v.id, unitIds: [p.unitId] });
  }
  return out;
}

function hardReasons(plan: Plan, p: Placement, u: CargoUnit, v: Vehicle): string[] {
  const reasons: string[] = [];
  const b = placementBox(p, u.spec);
  const tol = plan.settings.overlapTolerance;
  if (b.min.x < -tol || b.min.y < -tol || b.min.z < -tol || b.max.x > v.cargo.l + tol || b.max.y > v.cargo.w + tol || b.max.z > v.cargo.h + tol) reasons.push('outside the cargo space');
  for (const other of Object.values(plan.placements)) {
    if (other.unitId === p.unitId || other.vehicleId !== p.vehicleId) continue;
    const ou = plan.lines.find((l) => other.unitId.startsWith(`${l.id}#`));
    if (ou && boxesOverlap(b, placementBox(other, ou.spec), tol)) {
      reasons.push('overlaps another unit');
      break;
    }
  }
  return reasons;
}

export interface MoveCheck {
  ok: boolean;
  /** Human-readable reasons when !ok, e.g. "Overlaps Press die set, crated". */
  reasons: string[];
}

/** Hard-constraint check for placing one unit at `candidate`, against the other units in that vehicle. */
export function validateMove(plan: Plan, candidate: Placement): MoveCheck {
  const line = plan.lines.find((l) => candidate.unitId.startsWith(`${l.id}#`));
  const v = plan.vehicles.find((x) => x.id === candidate.vehicleId);
  if (!line || !v) return { ok: false, reasons: ['Unknown unit or vehicle'] };
  const unit: CargoUnit = { id: candidate.unitId, lineId: line.id, index: 0, spec: line.spec, stopId: line.stopId, stopSeq: 0, priority: line.priority };
  const reasons = hardReasons({ ...plan, placements: { ...plan.placements, [candidate.unitId]: candidate } }, candidate, unit, v);
  return { ok: reasons.length === 0, reasons };
}
