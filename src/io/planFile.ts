import type { Plan } from '../domain/types';

/** Triggers a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'load-plan'
  );
}

/** Downloads the full plan as versioned JSON (exact round trip with readPlanFile). */
export function downloadPlanJson(plan: Plan): void {
  downloadBlob(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }), `${fileSlug(plan.name)}.loadplan.json`);
}

/** Parses and validates plan JSON; throws an Error with a readable message when invalid. */
export function parsePlanJson(text: string): Plan {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const p = data as Partial<Plan> | null;
  if (!p || typeof p !== 'object' || p.version !== 1) throw new Error('Not a LoadPlanner plan file (expected version 1).');
  for (const key of ['customers', 'stops', 'lines', 'vehicles'] as const) {
    if (!Array.isArray(p[key])) throw new Error(`Plan file is missing "${key}".`);
  }
  if (!p.vehicles!.length) throw new Error('Plan file has no vehicles.');
  if (!p.placements || typeof p.placements !== 'object') throw new Error('Plan file is missing "placements".');
  if (!p.settings || !p.meta) throw new Error('Plan file is missing settings or details.');
  if (typeof p.id !== 'string' || typeof p.name !== 'string') throw new Error('Plan file is missing its id or name.');
  const plan = p as Plan;
  const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const customerIds = new Set(plan.customers.map((c) => c?.id));
  const stopIds = new Set(plan.stops.map((s) => s?.id));
  const vehicleIds = new Set(plan.vehicles.map((v) => v?.id));
  for (const s of plan.stops) {
    if (typeof s?.id !== 'string' || !customerIds.has(s.customerId)) throw new Error(`Stop "${s?.name ?? '?'}" refers to an unknown customer.`);
  }
  for (const l of plan.lines) {
    const d = l?.spec?.dims;
    if (typeof l?.id !== 'string' || !d || !isNum(d.l) || !isNum(d.w) || !isNum(d.h) || !isNum(l.spec.weightKg)) throw new Error(`Item "${l?.spec?.name ?? '?'}" has invalid dimensions or weight.`);
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new Error(`Item "${l.spec.name}" has an invalid quantity.`);
    if (!stopIds.has(l.stopId)) throw new Error(`Item "${l.spec.name}" refers to an unknown stop.`);
  }
  for (const v of plan.vehicles) {
    if (typeof v?.id !== 'string' || !v.cargo || !isNum(v.cargo.l) || (v.statics?.type !== 'rigid' && v.statics?.type !== 'artic')) throw new Error(`Vehicle "${v?.name ?? '?'}" is incomplete.`);
  }
  for (const pl of Object.values(plan.placements)) {
    if (!pl || !vehicleIds.has(pl.vehicleId) || !pl.pos || !isNum(pl.pos.x)) throw new Error('Plan file has an invalid placement.');
  }
  return plan;
}

export async function readPlanFile(file: File): Promise<Plan> {
  return parsePlanJson(await file.text());
}
