import type { UnitSystem } from '../domain/types';
import { formatNumber, fromKg } from '../domain/units';

/** Axle load against its limit: "15.4 / 15.4 t" (metric) or "33,950 / 34,000 lb" (imperial). */
export function axleLoadText(kg: number, maxKg: number, sys: UnitSystem): string {
  const unit = sys === 'metric' ? 't' : 'lb';
  const digits = unit === 't' ? 1 : 0;
  return `${formatNumber(fromKg(kg, unit), digits)} / ${formatNumber(fromKg(maxKg, unit), digits)} ${unit}`;
}
