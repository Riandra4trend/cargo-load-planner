import { uid } from '../domain/ids';
import type { Id, ItemTemplate, Plan, UnitSystem } from '../domain/types';
import { parsePlanJson, upgradeSpec } from './planFile';

/**
 * Browser persistence (localStorage). Every value is JSON; corrupt or foreign entries are ignored.
 * Writes throw a readable Error (StorageFullError when the quota is exhausted); callers toast it.
 */

const PREFIX = 'loadplanner:v1:';
export const STORAGE_KEYS = {
  current: `${PREFIX}current`,
  plans: `${PREFIX}plans`,
  plan: (id: Id) => `${PREFIX}plan:${id}`,
  library: `${PREFIX}library`,
} as const;

/** Entry of the saved-plans index. */
export interface SavedPlanInfo {
  id: Id;
  name: string;
  /** Epoch ms of the last save. */
  updatedAt: number;
  units: UnitSystem;
  /** Vehicle names. */
  vehicles: string[];
}

export class StorageFullError extends Error {
  constructor() {
    super('Browser storage is full. Delete saved plans or export them as JSON files to free space.');
    this.name = 'StorageFullError';
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Some browsers throw on access when storage is disabled.
    return null;
  }
}

function isQuotaError(err: unknown): boolean {
  const e = err as { name?: unknown; code?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
}

function readJson(key: string): unknown {
  const raw = storage()?.getItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  const s = storage();
  if (!s) throw new Error('Browser storage is not available, so plans cannot be saved here. Export them as JSON instead.');
  try {
    s.setItem(key, value);
  } catch (err) {
    if (isQuotaError(err)) throw new StorageFullError();
    throw new Error(`Could not save to browser storage: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function readPlan(key: string): Plan | null {
  const raw = storage()?.getItem(key);
  if (raw == null) return null;
  try {
    return parsePlanJson(raw);
  } catch {
    return null;
  }
}

// --- autosave ---------------------------------------------------------------

/** The autosaved working plan, or null when there is none or it is unreadable. */
export function loadAutosave(): Plan | null {
  return readPlan(STORAGE_KEYS.current);
}

export function saveAutosave(plan: Plan): void {
  write(STORAGE_KEYS.current, JSON.stringify(plan));
}

// --- named plans ------------------------------------------------------------

function isInfo(x: unknown): x is SavedPlanInfo {
  const i = x as Partial<SavedPlanInfo> | null;
  return !!i && typeof i === 'object' && typeof i.id === 'string' && typeof i.name === 'string' && typeof i.updatedAt === 'number' && (i.units === 'metric' || i.units === 'imperial') && Array.isArray(i.vehicles);
}

function readIndex(): SavedPlanInfo[] {
  const data = readJson(STORAGE_KEYS.plans);
  return Array.isArray(data) ? data.filter(isInfo) : [];
}

function writeIndex(index: SavedPlanInfo[]): void {
  write(STORAGE_KEYS.plans, JSON.stringify(index));
}

const infoOf = (plan: Plan): SavedPlanInfo => ({
  id: plan.id,
  name: plan.name,
  updatedAt: Date.now(),
  units: plan.settings.units,
  vehicles: plan.vehicles.map((v) => v.name),
});

/** Stores the plan body and upserts its index entry. The body is written first so the index never points at nothing. */
function store(plan: Plan): SavedPlanInfo {
  write(STORAGE_KEYS.plan(plan.id), JSON.stringify(plan));
  const info = infoOf(plan);
  const index = readIndex().filter((i) => i.id !== plan.id);
  try {
    writeIndex([info, ...index]);
  } catch (err) {
    storage()?.removeItem(STORAGE_KEYS.plan(plan.id));
    throw err;
  }
  return info;
}

/** Saved plans, most recently updated first. */
export function listSavedPlans(): SavedPlanInfo[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function isPlanSaved(id: Id): boolean {
  return readIndex().some((i) => i.id === id);
}

/** Saves a copy of the plan under a new id and name; returns the new entry. */
export function savePlanAs(plan: Plan, name: string): SavedPlanInfo {
  return store({ ...plan, id: uid('plan'), name: name.trim() || plan.name });
}

/** Replaces the saved plan `id` with `plan` (keeping the id). */
export function overwriteSavedPlan(id: Id, plan: Plan): SavedPlanInfo {
  return store({ ...plan, id });
}

/** The saved plan, or null when it is missing or unreadable. */
export function loadSavedPlan(id: Id): Plan | null {
  const plan = readPlan(STORAGE_KEYS.plan(id));
  return plan ? { ...plan, id } : null;
}

export function renameSavedPlan(id: Id, name: string): SavedPlanInfo | null {
  const plan = loadSavedPlan(id);
  const trimmed = name.trim();
  if (!plan || !trimmed) return null;
  write(STORAGE_KEYS.plan(id), JSON.stringify({ ...plan, name: trimmed }));
  // Renaming is not an edit: the entry keeps its timestamp and position.
  const index = readIndex();
  const entry = index.find((i) => i.id === id);
  const info: SavedPlanInfo = { ...(entry ?? infoOf(plan)), name: trimmed };
  writeIndex(entry ? index.map((i) => (i.id === id ? info : i)) : [info, ...index]);
  return info;
}

export function duplicateSavedPlan(id: Id): SavedPlanInfo | null {
  const plan = loadSavedPlan(id);
  return plan ? savePlanAs(plan, `${plan.name} (copy)`) : null;
}

export function deleteSavedPlan(id: Id): void {
  writeIndex(readIndex().filter((i) => i.id !== id));
  storage()?.removeItem(STORAGE_KEYS.plan(id));
}

// --- template library -------------------------------------------------------

function isTemplate(x: unknown): x is ItemTemplate {
  const t = x as Partial<ItemTemplate> | null;
  const spec = t?.spec;
  return !!t && typeof t.id === 'string' && !!spec && typeof spec.name === 'string' && !!spec.dims && typeof spec.weightKg === 'number';
}

/** User-saved item templates (never the built-in ones). */
export function loadLibrary(): ItemTemplate[] {
  const data = readJson(STORAGE_KEYS.library);
  return Array.isArray(data) ? data.filter(isTemplate).map((t) => ({ ...t, spec: upgradeSpec(t.spec), builtIn: false })) : [];
}

export function saveLibrary(templates: ItemTemplate[]): void {
  write(STORAGE_KEYS.library, JSON.stringify(templates.filter((t) => !t.builtIn)));
}
