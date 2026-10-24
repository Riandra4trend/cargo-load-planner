import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyPlan } from '../data/emptyPlan';
import { createSeedPlan, makeSpec } from '../data/seed';
import {
  deleteSavedPlan,
  duplicateSavedPlan,
  isPlanSaved,
  listSavedPlans,
  loadAutosave,
  loadLibrary,
  loadSavedPlan,
  overwriteSavedPlan,
  renameSavedPlan,
  saveAutosave,
  saveLibrary,
  savePlanAs,
  StorageFullError,
  STORAGE_KEYS,
} from './persistence';

/** In-memory Storage with an optional quota (in characters) to exercise QuotaExceededError handling. */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  constructor(private quota = Infinity) {}
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    const used = [...this.data].reduce((n, [k, v]) => n + (k === key ? 0 : v.length), 0);
    if (used + value.length > this.quota) {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.data.set(key, value);
  }
}

const g = globalThis as { localStorage?: Storage };

describe('persistence', () => {
  beforeEach(() => {
    g.localStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete g.localStorage;
  });

  it('autosaves and restores the plan exactly; ignores corrupt data', () => {
    expect(loadAutosave()).toBeNull();
    const plan = createSeedPlan();
    saveAutosave(plan);
    expect(loadAutosave()).toEqual(plan);
    localStorage.setItem(STORAGE_KEYS.current, '{not json');
    expect(loadAutosave()).toBeNull();
    localStorage.setItem(STORAGE_KEYS.current, JSON.stringify({ version: 1, lines: 'x' }));
    expect(loadAutosave()).toBeNull();
  });

  it('saves, lists, opens, renames, duplicates and deletes named plans', () => {
    const plan = createSeedPlan();
    const saved = savePlanAs(plan, '  Monday run ');
    expect(saved.name).toBe('Monday run');
    expect(saved.id).not.toBe(plan.id);
    expect(saved.units).toBe('metric');
    expect(saved.vehicles).toEqual([plan.vehicles[0].name]);
    expect(isPlanSaved(saved.id)).toBe(true);
    expect(loadSavedPlan(saved.id)).toEqual({ ...plan, id: saved.id, name: 'Monday run' });

    const empty = createEmptyPlan('us-dry-van-53');
    empty.settings.units = 'imperial';
    const second = overwriteSavedPlan(empty.id, empty);
    expect(listSavedPlans().map((p) => p.id).sort()).toEqual([saved.id, second.id].sort());
    expect(listSavedPlans().find((p) => p.id === second.id)?.units).toBe('imperial');

    const renamed = renameSavedPlan(saved.id, 'Tuesday run');
    expect(renamed?.name).toBe('Tuesday run');
    expect(renamed?.updatedAt).toBe(saved.updatedAt);
    expect(loadSavedPlan(saved.id)?.name).toBe('Tuesday run');
    expect(renameSavedPlan(saved.id, '   ')).toBeNull();

    const copy = duplicateSavedPlan(saved.id)!;
    expect(copy.name).toBe('Tuesday run (copy)');
    expect(loadSavedPlan(copy.id)?.lines).toEqual(plan.lines);

    deleteSavedPlan(saved.id);
    expect(isPlanSaved(saved.id)).toBe(false);
    expect(loadSavedPlan(saved.id)).toBeNull();
    expect(listSavedPlans()).toHaveLength(2);
  });

  it('ignores a corrupt index', () => {
    localStorage.setItem(STORAGE_KEYS.plans, '[{"id":1}, "x", null]');
    expect(listSavedPlans()).toEqual([]);
    localStorage.setItem(STORAGE_KEYS.plans, 'nope');
    expect(listSavedPlans()).toEqual([]);
  });

  it('reports a full storage without leaving a dangling entry', () => {
    g.localStorage = new MemoryStorage(5000);
    expect(() => savePlanAs(createSeedPlan(), 'Too big')).toThrow(StorageFullError);
    expect(listSavedPlans()).toEqual([]);
    expect(() => saveAutosave(createSeedPlan())).toThrow(/storage is full/);
  });

  it('persists user templates only', () => {
    const spec = makeSpec({ name: 'Crate', dims: { l: 1, w: 1, h: 1 }, weightKg: 100 });
    saveLibrary([
      { id: 'tpl-1', spec, builtIn: false, contents: '4 pcs' },
      { id: 'tpl-2', spec, builtIn: true },
    ]);
    expect(loadLibrary()).toEqual([{ id: 'tpl-1', spec, builtIn: false, contents: '4 pcs' }]);
    localStorage.setItem(STORAGE_KEYS.library, '[{"id":"x"}]');
    expect(loadLibrary()).toEqual([]);
  });
});
