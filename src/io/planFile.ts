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
  return p as Plan;
}

export async function readPlanFile(file: File): Promise<Plan> {
  return parsePlanJson(await file.text());
}
