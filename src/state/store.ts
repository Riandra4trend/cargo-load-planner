import { produce, type Draft } from 'immer';
import { create } from 'zustand';
import { createSeedPlan } from '../data/seed';
import { stopColor } from '../domain/colors';
import { allowedOrientations, lineIdOfUnit, orientedSize, unitIdOf } from '../domain/geometry';
import { uid } from '../domain/ids';
import { createVehicle } from '../domain/presets';
import type {
  CargoLine,
  ColorMode,
  Customer,
  FixAction,
  Id,
  ItemSpec,
  ItemTemplate,
  Orientation,
  Placement,
  Plan,
  PlanMeta,
  PlanSettings,
  Stop,
  TempZone,
  Vec3,
  Vehicle,
} from '../domain/types';
import { runOptimiseInWorker, type OptimiseResult } from '../packing';
import { validateMove } from '../rules';

export type ViewMode = '3d' | 'side' | 'top' | 'plan';
export type NavPanel = 'loadplan' | 'orders' | 'dock' | 'route';
export type TableTab = 'all' | 'onVehicle' | 'unplaced' | 'vehicle2' | 'hazmat' | 'temperature';

export interface ItemEditorRequest {
  mode: 'create' | 'edit';
  /** Edit mode: the line being edited. */
  lineId?: Id;
  /** Create mode: prefill from this template. */
  templateId?: Id;
  /** Create mode: preselected stop. */
  stopId?: Id;
}

export interface DialogState {
  itemEditor?: ItemEditorRequest;
  vehicleEditor?: { mode: 'create' | 'edit'; vehicleId?: Id };
  import?: true;
  urgent?: true;
  settings?: true;
  plans?: true;
  share?: true;
  report?: true;
  /** Material weights reference (liquid and dry-bulk densities with a volume → weight calculator). */
  materials?: true;
}

export interface DragState {
  unitId: Id;
  /** Candidate placement following the pointer. */
  ghost: Placement;
  /** Whether the ghost satisfies every hard constraint. */
  valid: boolean;
  reasons: string[];
  /** Placement before the drag (null when dragging an unplaced unit in). */
  origin: Placement | null;
}

export interface OptimiseOutcome extends OptimiseResult {
  vehicleIds: Id[];
}

export interface OptimiseState {
  running: boolean;
  progress: number;
  error?: string;
  /** Finished result awaiting Accept / Revert: `preview` is the plan with the result applied. */
  diff?: { base: Plan; preview: Plan; outcome: OptimiseOutcome };
}

export interface AnimationState {
  mode: 'idle' | 'load' | 'unload';
  vehicleId: Id | null;
  /** load: index into the loading sequence (units before it are aboard); unload: stage (0 = depart, k = after stop k). */
  step: number;
  playing: boolean;
  /** Playback speed multiplier. */
  speed: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export interface UiState {
  selection: Id[];
  hoverUnitId: Id | null;
  hoverAxle: { vehicleId: Id; axleId: Id } | null;
  activeVehicleId: Id;
  view: ViewMode;
  colorMode: ColorMode;
  nav: NavPanel;
  tableTab: TableTab;
  search: string;
  dialogs: DialogState;
  drag: DragState | null;
  optimise: OptimiseState;
  animation: AnimationState;
  /** Camera focus request; the scene reacts to nonce changes. */
  focus: { unitId: Id | null; nonce: number };
  toasts: Toast[];
  /** Line ids to highlight in the table (e.g. freshly added urgent rows). */
  highlightLines: Id[];
  /** Cargo palette (ready-made goods to add to the active vehicle) is open. */
  paletteOpen: boolean;
}

export interface LinePatch extends Partial<Omit<CargoLine, 'id' | 'spec'>> {
  spec?: Partial<ItemSpec>;
}

export interface StoreState {
  plan: Plan;
  past: Plan[];
  future: Plan[];
  /** User-saved item templates (built-in templates live in data/templates.ts). */
  library: ItemTemplate[];
  ui: UiState;

  // history -------------------------------------------------------------
  /** Applies a recipe to the plan as one undoable step. */
  commit: (label: string, recipe: (draft: Draft<Plan>) => void) => void;
  undo: () => void;
  redo: () => void;
  replacePlan: (plan: Plan, opts?: { keepHistory?: boolean }) => void;

  // plan meta / settings ------------------------------------------------
  renamePlan: (name: string) => void;
  updateMeta: (patch: Partial<PlanMeta>) => void;
  updateSettings: (patch: Partial<PlanSettings>) => void;

  // lines -----------------------------------------------------------------
  addLine: (line: Omit<CargoLine, 'id'>) => Id;
  /** Adds several lines as one undo step; returns their ids. */
  addLines: (lines: Omit<CargoLine, 'id'>[]) => Id[];
  /**
   * Adds a cargo line and places its units in one undo step. `place` receives the plan that already
   * contains the new (unplaced) line plus the line id, and returns the placements to apply.
   */
  addLineAndPlace: (line: Omit<CargoLine, 'id'>, place: (plan: Plan, lineId: Id) => Placement[], label?: string) => Id;
  updateLine: (id: Id, patch: LinePatch) => void;
  removeLines: (ids: Id[]) => void;
  duplicateLine: (id: Id) => Id | null;

  // customers / stops ---------------------------------------------------
  /** Adds a stop at the end of the route; `distanceKm` = driving distance from the previous stop. */
  addStop: (input: { name: string; customerName: string; color?: string; distanceKm?: number }) => Id;
  updateStop: (id: Id, patch: Partial<Omit<Stop, 'id'>>) => void;
  updateCustomer: (id: Id, patch: Partial<Omit<Customer, 'id'>>) => void;
  /** New delivery order; sequences become 1..n in this order. */
  reorderStops: (orderedIds: Id[]) => void;
  /** Fails (returns false) while lines still reference the stop. */
  removeStop: (id: Id) => boolean;

  // vehicles --------------------------------------------------------------
  addVehicle: (presetOrVehicle: string | Vehicle) => Id;
  /** Replaces the whole vehicle definition (vehicle editor). Units that no longer fit stay placed and get flagged. */
  updateVehicle: (vehicle: Vehicle) => void;
  /** Swaps a vehicle for a preset; its units become unplaced (caller usually runs Optimise next). */
  switchVehiclePreset: (vehicleId: Id, presetId: string) => void;
  removeVehicle: (vehicleId: Id) => void;
  setSlider: (vehicleId: Id, x: number) => void;
  setZones: (vehicleId: Id, zones: TempZone[]) => void;

  // placements ------------------------------------------------------------
  placeUnits: (placements: Placement[], label?: string) => void;
  moveUnit: (unitId: Id, pos: Vec3, orient?: Orientation) => void;
  /** Turns a placed unit to its next allowed orientation around its footprint centre; false (with a toast) if blocked. */
  rotateUnit: (unitId: Id) => boolean;
  unplaceUnits: (unitIds: Id[]) => void;
  togglePin: (unitId: Id) => void;
  /** Puts a bulk fill into a tank compartment or tipper body (one fill per compartment). */
  assignCompartment: (unitId: Id, vehicleId: Id, compartmentId: Id) => void;
  applyFix: (action: FixAction) => void;

  // optimise --------------------------------------------------------------
  startOptimise: (opts?: { vehicleIds?: Id[]; unitIds?: Id[]; keepExisting?: boolean; autoAccept?: boolean }) => void;
  cancelOptimise: () => void;
  acceptOptimise: () => void;
  discardOptimise: () => void;

  // template library ----------------------------------------------------
  saveTemplate: (spec: ItemSpec, contents?: string) => Id;
  removeTemplate: (id: Id) => void;
  setLibrary: (templates: ItemTemplate[]) => void;

  // ui --------------------------------------------------------------------
  select: (ids: Id[], mode?: 'replace' | 'toggle' | 'add') => void;
  setHover: (unitId: Id | null) => void;
  setHoverAxle: (axle: UiState['hoverAxle']) => void;
  setActiveVehicle: (vehicleId: Id) => void;
  setView: (view: ViewMode) => void;
  setColorMode: (mode: ColorMode) => void;
  setNav: (nav: NavPanel) => void;
  setTableTab: (tab: TableTab) => void;
  setSearch: (search: string) => void;
  setPaletteOpen: (open: boolean) => void;
  openDialog: <K extends keyof DialogState>(key: K, value: NonNullable<DialogState[K]>) => void;
  closeDialog: (key: keyof DialogState) => void;
  setDrag: (drag: DragState | null) => void;
  setAnimation: (patch: Partial<AnimationState>) => void;
  requestFocus: (unitId: Id | null) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  setHighlightLines: (lineIds: Id[]) => void;
}

const HISTORY_LIMIT = 100;
let toastSeq = 0;
let optimiseJob: { cancel: () => void } | null = null;

/** Applies an optimiser result to a plan (pure). */
export function applyOptimiseResult(plan: Plan, outcome: OptimiseOutcome): Plan {
  return produce(plan, (d) => {
    const involved = new Set(outcome.vehicleIds);
    for (const [unitId, p] of Object.entries(d.placements)) {
      if (involved.has(p.vehicleId) && !p.pinned) delete d.placements[unitId];
    }
    for (const [unitId, p] of Object.entries(outcome.placements)) d.placements[unitId] = p;
    for (const u of outcome.unplaced) delete d.placements[u.unitId];
    for (const v of d.vehicles) {
      const zones = outcome.zones[v.id];
      if (zones) v.zones = zones;
      const slider = outcome.sliders[v.id];
      if (slider !== undefined && v.statics.type === 'artic') v.statics.trailerAxle.x = slider;
    }
  });
}

function initialUi(plan: Plan): UiState {
  return {
    selection: [],
    hoverUnitId: null,
    hoverAxle: null,
    activeVehicleId: plan.vehicles[0]?.id ?? '',
    view: '3d',
    colorMode: 'stop',
    nav: 'loadplan',
    tableTab: 'all',
    search: '',
    dialogs: {},
    drag: null,
    optimise: { running: false, progress: 0 },
    animation: { mode: 'idle', vehicleId: null, step: 0, playing: false, speed: 1 },
    focus: { unitId: null, nonce: 0 },
    toasts: [],
    highlightLines: [],
    paletteOpen: false,
  };
}

function normaliseSequences(d: Draft<Plan>) {
  [...d.stops].sort((a, b) => a.sequence - b.sequence).forEach((s, i) => (s.sequence = i + 1));
}

export const useStore = create<StoreState>()((set, get) => {
  const seed = createSeedPlan();

  const setUi = (patch: Partial<UiState> | ((ui: UiState) => Partial<UiState>)) =>
    set((s) => ({ ui: { ...s.ui, ...(typeof patch === 'function' ? patch(s.ui) : patch) } }));

  const commit: StoreState['commit'] = (_label, recipe) => {
    const { plan, past } = get();
    const next = produce(plan, recipe);
    if (next === plan) return;
    set({ plan: next, past: [...past, plan].slice(-HISTORY_LIMIT), future: [] });
  };

  return {
    plan: seed,
    past: [],
    future: [],
    library: [],
    ui: initialUi(seed),

    commit,
    undo: () => {
      const { past, plan, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({ plan: prev, past: past.slice(0, -1), future: [plan, ...future] });
    },
    redo: () => {
      const { past, plan, future } = get();
      const next = future[0];
      if (!next) return;
      set({ plan: next, past: [...past, plan], future: future.slice(1) });
    },
    replacePlan: (plan, opts) => {
      const { past, plan: current, ui } = get();
      set({
        plan,
        past: opts?.keepHistory ? [...past, current].slice(-HISTORY_LIMIT) : [],
        future: [],
        ui: { ...initialUi(plan), view: ui.view, colorMode: ui.colorMode, toasts: ui.toasts, paletteOpen: ui.paletteOpen },
      });
    },

    renamePlan: (name) => commit('Rename plan', (d) => void (d.name = name)),
    updateMeta: (patch) => commit('Edit plan details', (d) => void Object.assign(d.meta, patch)),
    updateSettings: (patch) => commit('Edit settings', (d) => void Object.assign(d.settings, patch)),

    addLine: (line) => get().addLines([line])[0],
    addLines: (lines) => {
      const ids = lines.map(() => uid('line'));
      commit('Add items', (d) => {
        lines.forEach((l, i) => d.lines.push({ ...structuredClone(l), id: ids[i] }));
      });
      return ids;
    },
    addLineAndPlace: (line, place, label = 'Add cargo') => {
      const id = uid('line');
      const current = get().plan;
      const placements = place({ ...current, lines: [...current.lines, { ...structuredClone(line), id }] }, id);
      commit(label, (d) => {
        d.lines.push({ ...structuredClone(line), id });
        for (const p of placements) d.placements[p.unitId] = structuredClone(p);
      });
      return id;
    },
    updateLine: (id, patch) =>
      commit('Edit item', (d) => {
        const line = d.lines.find((l) => l.id === id);
        if (!line) return;
        const { spec, ...rest } = patch;
        Object.assign(line, rest);
        if (spec) Object.assign(line.spec, spec);
        line.quantity = Math.max(1, Math.round(line.quantity));
        for (const unitId of Object.keys(d.placements)) {
          if (lineIdOfUnit(unitId) !== id) continue;
          const index = Number(unitId.slice(unitId.lastIndexOf('#') + 1));
          if (index >= line.quantity) delete d.placements[unitId];
          else if (spec && !allowedOrientations(line.spec).includes(d.placements[unitId].orient)) d.placements[unitId].orient = allowedOrientations(line.spec)[0];
        }
      }),
    removeLines: (ids) =>
      commit('Remove items', (d) => {
        const drop = new Set(ids);
        d.lines = d.lines.filter((l) => !drop.has(l.id));
        for (const unitId of Object.keys(d.placements)) if (drop.has(lineIdOfUnit(unitId))) delete d.placements[unitId];
      }),
    duplicateLine: (id) => {
      const line = get().plan.lines.find((l) => l.id === id);
      if (!line) return null;
      const { id: _old, ...rest } = line;
      return get().addLine({ ...rest, spec: { ...rest.spec, name: `${rest.spec.name} (copy)` } });
    },

    addStop: ({ name, customerName, color, distanceKm = 0 }) => {
      const stopId = uid('stop');
      commit('Add stop', (d) => {
        const sequence = d.stops.length + 1;
        let customer = d.customers.find((c) => c.name.toLowerCase() === customerName.trim().toLowerCase());
        if (!customer) {
          customer = { id: uid('cust'), name: customerName.trim() || name, color: color ?? stopColor(sequence) };
          d.customers.push(customer);
        }
        d.stops.push({ id: stopId, name, customerId: customer.id, sequence, distanceKm });
      });
      return stopId;
    },
    updateStop: (id, patch) =>
      commit('Edit stop', (d) => {
        const stop = d.stops.find((s) => s.id === id);
        if (stop) Object.assign(stop, patch);
        normaliseSequences(d);
      }),
    updateCustomer: (id, patch) =>
      commit('Edit customer', (d) => {
        const c = d.customers.find((x) => x.id === id);
        if (c) Object.assign(c, patch);
      }),
    reorderStops: (orderedIds) =>
      commit('Reorder stops', (d) => {
        orderedIds.forEach((id, i) => {
          const s = d.stops.find((x) => x.id === id);
          if (s) s.sequence = i + 1;
        });
        normaliseSequences(d);
      }),
    removeStop: (id) => {
      if (get().plan.lines.some((l) => l.stopId === id)) return false;
      commit('Remove stop', (d) => {
        d.stops = d.stops.filter((s) => s.id !== id);
        normaliseSequences(d);
      });
      return true;
    },

    addVehicle: (presetOrVehicle) => {
      const vehicle = typeof presetOrVehicle === 'string' ? createVehicle(presetOrVehicle) : structuredClone(presetOrVehicle);
      commit('Add vehicle', (d) => {
        vehicle.name = `Truck ${d.vehicles.length + 1} · ${vehicle.name.replace(/^Truck \d+ · /, '')}`;
        d.vehicles.push(vehicle);
      });
      return vehicle.id;
    },
    updateVehicle: (vehicle) =>
      commit('Edit vehicle', (d) => {
        const i = d.vehicles.findIndex((v) => v.id === vehicle.id);
        if (i >= 0) d.vehicles[i] = structuredClone(vehicle);
      }),
    switchVehiclePreset: (vehicleId, presetId) =>
      commit('Switch vehicle', (d) => {
        const i = d.vehicles.findIndex((v) => v.id === vehicleId);
        if (i < 0) return;
        const fresh = createVehicle(presetId, vehicleId);
        fresh.name = `Truck ${i + 1} · ${fresh.name}`;
        d.vehicles[i] = fresh;
        for (const [unitId, p] of Object.entries(d.placements)) if (p.vehicleId === vehicleId) delete d.placements[unitId];
      }),
    removeVehicle: (vehicleId) => {
      if (get().plan.vehicles.length <= 1) return;
      commit('Remove vehicle', (d) => {
        d.vehicles = d.vehicles.filter((v) => v.id !== vehicleId);
        for (const [unitId, p] of Object.entries(d.placements)) if (p.vehicleId === vehicleId) delete d.placements[unitId];
      });
      const { ui, plan } = get();
      if (ui.activeVehicleId === vehicleId) setUi({ activeVehicleId: plan.vehicles[0].id });
    },
    setSlider: (vehicleId, x) =>
      commit('Slide tandem', (d) => {
        const v = d.vehicles.find((x2) => x2.id === vehicleId);
        if (v?.statics.type === 'artic') v.statics.trailerAxle.x = x;
      }),
    setZones: (vehicleId, zones) =>
      commit('Move bulkheads', (d) => {
        const v = d.vehicles.find((x) => x.id === vehicleId);
        if (v) v.zones = structuredClone(zones);
      }),

    placeUnits: (placements, label = 'Place units') =>
      commit(label, (d) => {
        for (const p of placements) d.placements[p.unitId] = structuredClone(p);
      }),
    moveUnit: (unitId, pos, orient) =>
      commit('Move unit', (d) => {
        const p = d.placements[unitId];
        if (!p) return;
        p.pos = { ...pos };
        if (orient !== undefined) p.orient = orient;
      }),
    rotateUnit: (unitId) => {
      const { plan } = get();
      const p = plan.placements[unitId];
      const line = plan.lines.find((l) => l.id === lineIdOfUnit(unitId));
      if (!p || !line) return false;
      const options = allowedOrientations(line.spec);
      if (options.length < 2) {
        get().toast(`${line.spec.name} must not be rotated`, 'error');
        return false;
      }
      const orient = options[(options.indexOf(p.orient) + 1) % options.length];
      const before = orientedSize(line.spec.dims, p.orient);
      const after = orientedSize(line.spec.dims, orient);
      const pos = { x: p.pos.x + (before.x - after.x) / 2, y: p.pos.y + (before.y - after.y) / 2, z: p.pos.z };
      const check = validateMove(plan, { ...p, pos, orient });
      if (!check.ok) {
        get().toast(`Can't rotate here: ${check.reasons[0] ?? 'blocked'}`, 'error');
        return false;
      }
      get().moveUnit(unitId, pos, orient);
      return true;
    },
    unplaceUnits: (unitIds) =>
      commit('Remove from vehicle', (d) => {
        for (const id of unitIds) delete d.placements[id];
      }),
    assignCompartment: (unitId, vehicleId, compartmentId) =>
      commit('Fill compartment', (d) => {
        const bulk = d.vehicles.find((v) => v.id === vehicleId)?.bulk;
        const c = bulk?.compartments.find((x) => x.id === compartmentId);
        if (!bulk || !c) return;
        const prev = d.placements[unitId];
        // A fill already in the target swaps into the moved fill's old compartment on this vehicle, else it is unloaded.
        const occupant = Object.values(d.placements).find((p) => p.unitId !== unitId && p.vehicleId === vehicleId && p.compartmentId === compartmentId);
        if (occupant) {
          const back = prev?.vehicleId === vehicleId ? bulk.compartments.find((x) => x.id === prev.compartmentId) : undefined;
          if (back) d.placements[occupant.unitId] = { ...occupant, compartmentId: back.id, pos: { x: back.fromX, y: 0, z: 0 } };
          else delete d.placements[occupant.unitId];
        }
        d.placements[unitId] = { unitId, vehicleId, compartmentId, pos: { x: c.fromX, y: 0, z: 0 }, orient: 0, ...(prev?.pinned ? { pinned: true } : {}) };
      }),
    togglePin: (unitId) =>
      commit('Pin unit', (d) => {
        const p = d.placements[unitId];
        if (p) p.pinned = !p.pinned;
      }),
    applyFix: (action) => {
      if (action.type === 'slider') get().setSlider(action.vehicleId, action.x);
      else if (action.type === 'compartment') get().assignCompartment(action.unitId, action.vehicleId, action.compartmentId);
      else get().moveUnit(action.unitId, action.pos, action.orient);
    },

    startOptimise: (opts = {}) => {
      const { plan, ui } = get();
      if (ui.optimise.running) return;
      const vehicleIds = opts.vehicleIds ?? plan.vehicles.map((v) => v.id);
      setUi({ optimise: { running: true, progress: 0 } });
      const job = runOptimiseInWorker(
        { plan, vehicleIds, unitIds: opts.unitIds, keepExisting: !!opts.keepExisting, seed: plan.settings.seed, timeBudgetMs: plan.settings.optimiserTimeMs },
        (progress) => setUi((u) => ({ optimise: { ...u.optimise, progress } })),
      );
      optimiseJob = job;
      job.promise.then(
        (result) => {
          if (optimiseJob !== job) return;
          optimiseJob = null;
          const outcome: OptimiseOutcome = { ...result, vehicleIds };
          setUi({ optimise: { running: false, progress: 1, diff: { base: plan, preview: applyOptimiseResult(plan, outcome), outcome } } });
          if (opts.autoAccept) get().acceptOptimise();
        },
        (err: unknown) => {
          if (optimiseJob !== job) return;
          optimiseJob = null;
          const message = err instanceof Error ? err.message : String(err);
          setUi({ optimise: { running: false, progress: 0, error: message === 'cancelled' ? undefined : message } });
        },
      );
    },
    cancelOptimise: () => {
      optimiseJob?.cancel();
      optimiseJob = null;
      setUi({ optimise: { running: false, progress: 0 } });
    },
    acceptOptimise: () => {
      const diff = get().ui.optimise.diff;
      if (!diff) return;
      const { preview } = diff;
      commit('Optimise', (d) => {
        d.placements = structuredClone(preview.placements);
        d.vehicles = structuredClone(preview.vehicles);
      });
      setUi({ optimise: { running: false, progress: 0 } });
      const placed = Object.keys(preview.placements).filter((id) => !diff.base.placements[id]).length;
      const moved = diff.outcome.moved;
      const parts = [`${moved} unit${moved === 1 ? '' : 's'} moved`];
      if (placed) parts.unshift(`${placed} placed`);
      get().toast(`Optimised: ${parts.join(', ')}`, 'success');
    },
    discardOptimise: () => setUi({ optimise: { running: false, progress: 0 } }),

    saveTemplate: (spec, contents) => {
      const id = uid('tpl');
      set((s) => ({ library: [...s.library, { id, spec: structuredClone(spec), contents, builtIn: false }] }));
      return id;
    },
    removeTemplate: (id) => set((s) => ({ library: s.library.filter((t) => t.id !== id) })),
    setLibrary: (templates) => set({ library: templates }),

    select: (ids, mode = 'replace') =>
      setUi((u) => {
        if (mode === 'replace') return { selection: ids };
        if (mode === 'add') return { selection: [...new Set([...u.selection, ...ids])] };
        const cur = new Set(u.selection);
        for (const id of ids) {
          if (cur.has(id)) cur.delete(id);
          else cur.add(id);
        }
        return { selection: [...cur] };
      }),
    setHover: (hoverUnitId) => {
      if (get().ui.hoverUnitId !== hoverUnitId) setUi({ hoverUnitId });
    },
    setHoverAxle: (hoverAxle) => setUi({ hoverAxle }),
    setActiveVehicle: (activeVehicleId) => setUi({ activeVehicleId }),
    setView: (view) => setUi({ view }),
    setColorMode: (colorMode) => setUi({ colorMode }),
    setNav: (nav) => setUi({ nav }),
    setTableTab: (tableTab) => setUi({ tableTab }),
    setSearch: (search) => setUi({ search }),
    setPaletteOpen: (paletteOpen) => setUi({ paletteOpen }),
    openDialog: (key, value) => setUi((u) => ({ dialogs: { ...u.dialogs, [key]: value } })),
    closeDialog: (key) =>
      setUi((u) => {
        const dialogs = { ...u.dialogs };
        delete dialogs[key];
        return { dialogs };
      }),
    setDrag: (drag) => setUi({ drag }),
    setAnimation: (patch) => setUi((u) => ({ animation: { ...u.animation, ...patch } })),
    requestFocus: (unitId) => setUi((u) => ({ focus: { unitId, nonce: u.focus.nonce + 1 } })),
    toast: (text, kind = 'info') => {
      const id = ++toastSeq;
      setUi((u) => ({ toasts: [...u.toasts, { id, text, kind }].slice(-4) }));
      setTimeout(() => get().dismissToast(id), 4200);
    },
    dismissToast: (id) => setUi((u) => ({ toasts: u.toasts.filter((t) => t.id !== id) })),
    setHighlightLines: (highlightLines) => setUi({ highlightLines }),
  };
});

/** Builds placement ids for all units of a line (helper for tests and editors). */
export const unitIdsOfLine = (line: Pick<CargoLine, 'id' | 'quantity'>): Id[] => Array.from({ length: line.quantity }, (_, i) => unitIdOf(line.id, i));
