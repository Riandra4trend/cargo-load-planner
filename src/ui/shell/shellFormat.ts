import { formatNumber, formatWeight, fromKg, kgToLb, M_PER_FT, weightUnit } from '../../domain/units';
import type { AxleStatus, Plan, Severity, UnitSystem } from '../../domain/types';
import type { VehicleEval } from '../../state/evaluate';

/** Tailwind background class of an axle bar per status. */
export const STATUS_BAR: Record<AxleStatus, string> = { legal: 'bg-ok', near: 'bg-warn', over: 'bg-bad', under: 'bg-bad' };
/** Tailwind text class per status. */
export const STATUS_TEXT: Record<AxleStatus, string> = { legal: 'text-ok', near: 'text-warn', over: 'text-bad', under: 'text-bad' };
/** Soft background per status (table cells). */
export const STATUS_SOFT: Record<AxleStatus, string> = { legal: 'bg-ok-soft text-ok', near: 'bg-warn-soft text-warn', over: 'bg-bad-soft text-bad', under: 'bg-bad-soft text-bad' };
/** Theme colours for SVG fills. */
export const STATUS_COLOR: Record<AxleStatus, string> = {
  legal: 'var(--color-ok)',
  near: 'var(--color-warn)',
  over: 'var(--color-bad)',
  under: 'var(--color-bad)',
};

export const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];
export const SEVERITY_LABEL: Record<Severity, string> = { error: 'Errors', warning: 'Warnings', info: 'Notes' };

/** "Depart" for stage 0, "After 2" for stage 2. */
export const stageShort = (stage: number): string => (stage === 0 ? 'Depart' : `After ${stage}`);

/** Concentrated floor load: metric "1,240 kg/m", imperial "833 lb/ft". */
export function formatLinearLoad(kgPerM: number, sys: UnitSystem): string {
  return sys === 'metric' ? `${formatNumber(kgPerM, 0)} kg/m` : `${formatNumber(kgToLb(kgPerM) * M_PER_FT, 0)} lb/ft`;
}

/** "5,815 / 7,500 kg" in the plan's weight unit. */
export function weightPair(kg: number, maxKg: number, sys: UnitSystem): string {
  return `${formatNumber(fromKg(kg, weightUnit(sys)), 0)} / ${formatWeight(maxKg, sys)}`;
}

export type Health = 'ok' | 'warn' | 'bad';

/** Traffic-light status of a vehicle from its violations and axle state. */
export function vehicleHealth(ve: VehicleEval): Health {
  if (ve.violations.some((v) => v.severity === 'error') || ve.stages.some((s) => s.axle.status === 'over' || s.axle.status === 'under')) return 'bad';
  if (ve.violations.some((v) => v.severity === 'warning') || ve.stages.some((s) => s.axle.status === 'near')) return 'warn';
  return 'ok';
}

export const HEALTH_DOT: Record<Health, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' };
export const HEALTH_LABEL: Record<Health, string> = { ok: 'All checks pass', warn: 'Warnings', bad: 'Rules broken' };

/** Customer colour per stop id. */
export function stopColors(plan: Plan): Map<string, string> {
  const byCustomer = new Map(plan.customers.map((c) => [c.id, c.color]));
  return new Map(plan.stops.map((s) => [s.id, byCustomer.get(s.customerId) ?? '#999999']));
}

/** Customer colour per stop sequence number. */
export function stopColorsBySeq(plan: Plan): Map<number, string> {
  const byCustomer = new Map(plan.customers.map((c) => [c.id, c.color]));
  return new Map(plan.stops.map((s) => [s.sequence, byCustomer.get(s.customerId) ?? '#999999']));
}

/** Round, human-friendly tick values from 0 to at least `max`. */
export function niceTicks(max: number, target = 5): number[] {
  if (!(max > 0)) return [0];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/** Lower-case first letter for running text ("Drive tandem" -> "drive tandem"). */
export const lowerFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** "Sat 24 Oct" from an ISO date (YYYY-MM-DD); falls back to the raw text. */
export function formatPlanDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
