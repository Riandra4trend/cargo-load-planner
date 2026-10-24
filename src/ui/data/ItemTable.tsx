import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Download,
  GripVertical,
  List,
  PackageMinus,
  PackagePlus,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TEMP_COLORS, TEMP_LABELS, hazmatColor } from '../../domain/colors';
import { isBulkLiquid, lineIdOfUnit, volumeOf } from '../../domain/geometry';
import { HAZMAT_CLASS_NAMES } from '../../domain/settings';
import type { CargoLine, CargoUnit, Customer, Id, Placement, Plan, Stop, UnitStatus, Vehicle } from '../../domain/types';
import { formatDims, formatLitres, formatWeight, fromKg, parseNumber, toKg, weightUnit } from '../../domain/units';
import { downloadItemsCsv } from '../../io/csv';
import { loadingSequence } from '../../sim/sequence';
import { useDisplayPlan, useEvaluation } from '../../state/hooks';
import { useStore, type TableTab } from '../../state/store';
import { Button, IconButton } from '../common/Button';
import { Card, CardHeader } from '../common/Card';
import { ColorDot, UnitStatusChip } from '../common/Chip';
import { inputClass } from '../common/fields';
import { placeOnVehicle, targetVehicleId } from './placement';

type SortKey = 'item' | 'sku' | 'origin' | 'category' | 'qty' | 'dims' | 'weight' | 'bay' | 'customer' | 'stop' | 'temp' | 'hazmat' | 'status';

interface Row {
  unit: CargoUnit;
  line: CargoLine;
  stop?: Stop;
  customer?: Customer;
  color: string;
  status: UnitStatus;
  placement?: Placement;
  /** Index of the vehicle the unit is placed in, -1 when unplaced. */
  vehicleIndex: number;
  bay: string;
}

const HIGHLIGHT_MS = 6000;
const STATUS_ORDER: Record<UnitStatus, number> = { check: 0, urgent: 1, unplaced: 2, planned: 3, loaded: 4 };
const TEMP_ORDER = { ambient: 0, chilled: 1, frozen: 2 } as const;
const MUTED = '#A8A49A';

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'item', label: 'Item' },
  { key: 'sku', label: 'SKU' },
  { key: 'origin', label: 'Origin' },
  { key: 'category', label: 'Category' },
  { key: 'qty', label: 'Qty', className: 'text-right' },
  { key: 'dims', label: 'Dims' },
  { key: 'weight', label: 'Weight', className: 'text-right' },
  { key: 'bay', label: 'Bay' },
  { key: 'customer', label: 'Customer' },
  { key: 'stop', label: 'Stop' },
  { key: 'temp', label: 'Temp' },
  { key: 'hazmat', label: 'Hazmat' },
  { key: 'status', label: 'Status' },
];

function sortValue(r: Row, key: SortKey): string | number {
  const s = r.unit.spec;
  switch (key) {
    case 'item':
      return s.name.toLowerCase();
    case 'sku':
      return s.sku.toLowerCase();
    case 'origin':
      return s.origin.toLowerCase();
    case 'category':
      return s.category.toLowerCase();
    case 'qty':
      return r.line.quantity;
    case 'dims':
      return isBulkLiquid(s) ? (s.liquid?.volumeL ?? 0) / 1000 : volumeOf(s.dims);
    case 'weight':
      return s.weightKg;
    case 'bay':
      return r.vehicleIndex < 0 ? '~' : `${r.vehicleIndex}:${r.bay}`;
    case 'customer':
      return (r.customer?.name ?? '').toLowerCase();
    case 'stop':
      return r.unit.stopSeq;
    case 'temp':
      return TEMP_ORDER[s.temp];
    case 'hazmat':
      return s.hazmat ? s.hazmat.hazClass : '~';
    case 'status':
      return STATUS_ORDER[r.status];
  }
}

function inTab(r: Row, tab: TableTab, activeId: Id | undefined, secondId: Id | undefined): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'onVehicle':
      return !!r.placement && r.placement.vehicleId === activeId;
    case 'unplaced':
      return !r.placement;
    case 'vehicle2':
      return !!r.placement && r.placement.vehicleId === secondId;
    case 'hazmat':
      return !!r.unit.spec.hazmat;
    case 'temperature':
      return r.unit.spec.temp !== 'ambient';
  }
}

const stopPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** Click-to-edit number cell; commits on Enter or blur, Esc cancels. */
function InlineNumber({ display, value, digits, label, onCommit, disabled, min }: { display: ReactNode; value: number; digits: number; label: string; onCommit: (n: number) => void; disabled?: boolean; min: number }) {
  const [text, setText] = useState<string | null>(null);
  if (text === null) {
    return (
      <button
        type="button"
        disabled={disabled}
        title={disabled ? undefined : `Edit ${label.toLowerCase()}`}
        aria-label={`Edit ${label.toLowerCase()}`}
        onClick={(e) => {
          e.stopPropagation();
          setText(String(Number(value.toFixed(digits))));
        }}
        className="rounded px-1 font-mono num hover:bg-black/5 hover:underline decoration-dotted underline-offset-2 disabled:hover:bg-transparent disabled:hover:no-underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {display}
      </button>
    );
  }
  const commit = () => {
    const n = parseNumber(text);
    if (Number.isFinite(n) && n >= min) onCommit(n);
    setText(null);
  };
  return (
    <input
      autoFocus
      aria-label={label}
      inputMode="decimal"
      value={text}
      onClick={stopPropagation}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setText(null);
      }}
      className={`${inputClass} num h-7 w-20 px-1.5 text-right text-xs`}
    />
  );
}

function StopChip({ seq, color }: { seq: number; color: string }) {
  return (
    <span className="inline-grid h-5 min-w-5 place-items-center rounded-full px-1 font-mono num text-[11px] font-semibold text-white" style={{ background: color }}>
      {seq}
    </span>
  );
}

function StopCell({ row, stops, customers, disabled, onChange }: { row: Row; stops: Stop[]; customers: Customer[]; disabled: boolean; onChange: (stopId: Id) => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={`Change stop (stop ${row.stop?.sequence ?? '?'})`}
        title={row.stop ? `${row.stop.name} · click to change` : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-accent"
      >
        <StopChip seq={row.stop?.sequence ?? 0} color={row.color} />
      </button>
    );
  }
  return (
    <select
      autoFocus
      aria-label="Stop"
      value={row.line.stopId}
      onClick={stopPropagation}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') setEditing(false);
      }}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        onChange(e.target.value);
        setEditing(false);
      }}
      className={`${inputClass} h-7 w-44 px-1.5 text-xs`}
    >
      {[...stops]
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.sequence} · {customers.find((c) => c.id === s.customerId)?.name ?? s.name}
          </option>
        ))}
    </select>
  );
}

/** Tanker compartment of a bulk fill on the active tanker: choosing a filled compartment swaps the fills, "—" unloads. */
function CompartmentCell({ plan, vehicle, unitId, current, disabled }: { plan: Plan; vehicle: Vehicle; unitId: Id; current?: Id; disabled: boolean }) {
  const sys = plan.settings.units;
  const occupantName = (compartmentId: Id): string | undefined => {
    const p = Object.values(plan.placements).find((x) => x.vehicleId === vehicle.id && x.compartmentId === compartmentId && x.unitId !== unitId);
    return p ? plan.lines.find((l) => l.id === lineIdOfUnit(p.unitId))?.spec.name : undefined;
  };
  const { assignCompartment, unplaceUnits } = useStore.getState();
  return (
    <select
      value={current ?? ''}
      disabled={disabled}
      aria-label="Tanker compartment"
      onClick={stopPropagation}
      onKeyDown={stopPropagation}
      onChange={(e) => (e.target.value ? assignCompartment(unitId, vehicle.id, e.target.value) : unplaceUnits([unitId]))}
      className={`${inputClass} h-7 w-24 px-1.5 font-mono text-xs`}
    >
      <option value="">—</option>
      {vehicle.tank!.compartments.map((c) => {
        const occupant = c.id === current ? undefined : occupantName(c.id);
        return (
          <option key={c.id} value={c.id}>
            {c.label} · {formatLitres(c.capacityL, sys, 0)}
            {c.id === current ? '' : occupant ? (current ? ` · swap with ${occupant}` : ` · unloads ${occupant}`) : ' · empty'}
          </option>
        );
      })}
    </select>
  );
}

export function ItemTable() {
  const plan = useDisplayPlan();
  const ev = useEvaluation();
  const sys = plan.settings.units;
  const wUnit = weightUnit(sys);
  const { animation, activeVehicleId, highlightLines, selection, hoverUnitId, tableTab, search, locked } = useStore(
    useShallow((s) => ({
      animation: s.ui.animation,
      activeVehicleId: s.ui.activeVehicleId,
      highlightLines: s.ui.highlightLines,
      selection: s.ui.selection,
      hoverUnitId: s.ui.hoverUnitId,
      tableTab: s.ui.tableTab,
      search: s.ui.search,
      locked: s.ui.optimise.running || !!s.ui.optimise.diff,
    })),
  );
  const store = useStore.getState;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loaded = useMemo(() => {
    if (animation.mode !== 'load' || !animation.vehicleId) return null;
    return new Set(loadingSequence(plan, animation.vehicleId).slice(0, animation.step).map((s) => s.unitId));
  }, [plan, animation.mode, animation.vehicleId, animation.step]);

  const rows = useMemo<Row[]>(() => {
    const lineById = new Map(plan.lines.map((l) => [l.id, l]));
    const stopById = new Map(plan.stops.map((s) => [s.id, s]));
    const customerById = new Map(plan.customers.map((c) => [c.id, c]));
    const vehicleIndex = new Map(plan.vehicles.map((v, i) => [v.id, i]));
    return ev.units.map((unit) => {
      const stop = stopById.get(unit.stopId);
      const customer = stop ? customerById.get(stop.customerId) : undefined;
      const placement = plan.placements[unit.id];
      return {
        unit,
        line: lineById.get(unit.lineId)!,
        stop,
        customer,
        color: customer?.color ?? MUTED,
        status: loaded?.has(unit.id) ? 'loaded' : ev.status[unit.id],
        placement,
        vehicleIndex: placement ? (vehicleIndex.get(placement.vehicleId) ?? -1) : -1,
        bay: ev.bayOfUnit[unit.id] ?? '',
      };
    });
  }, [plan, ev, loaded]);

  const secondId = plan.vehicles[1]?.id;
  const activeId = plan.vehicles.some((v) => v.id === activeVehicleId) ? activeVehicleId : plan.vehicles[0]?.id;
  const activeTanker = plan.vehicles.find((v) => v.id === activeId && v.tank);
  const tab: TableTab = tableTab === 'vehicle2' && !secondId ? 'all' : tableTab;
  const tabs: { key: TableTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'onVehicle', label: plan.vehicles.length > 1 ? `On ${plan.vehicles.find((v) => v.id === activeId)?.name.split(' · ')[0] ?? 'vehicle'}` : 'On vehicle' },
    { key: 'unplaced', label: 'Unplaced' },
    ...(secondId ? [{ key: 'vehicle2' as const, label: 'Vehicle 2' }] : []),
    { key: 'hazmat', label: 'Hazmat' },
    { key: 'temperature', label: 'Temperature' },
  ];

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => {
    const list = rows.filter((r) => {
      if (!inTab(r, tab, activeId, secondId)) return false;
      if (!q) return true;
      const s = r.unit.spec;
      return [s.name, s.sku, s.liquid?.name ?? '', r.customer?.name ?? '', r.stop?.name ?? '', `stop ${r.unit.stopSeq}`].some((t) => t.toLowerCase().includes(q));
    });
    if (!sort) return list;
    return list
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const va = sortValue(a.r, sort.key);
        const vb = sortValue(b.r, sort.key);
        const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
        return c * sort.dir || a.i - b.i;
      })
      .map((x) => x.r);
  }, [rows, tab, q, sort, activeId, secondId]);

  const highlighted = useMemo(() => new Set(highlightLines), [highlightLines]);
  const selected = useMemo(() => new Set(selection), [selection]);

  // Fade highlighted (e.g. urgent) rows after a few seconds and bring the first one into view.
  useEffect(() => {
    if (!highlightLines.length) return;
    scrollRowIntoView(scrollRef.current, `[data-line="${CSS.escape(highlightLines[0])}"]`);
    const t = setTimeout(() => useStore.getState().setHighlightLines([]), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlightLines]);

  // Selecting a unit elsewhere (3D) scrolls its row into view inside the table.
  useEffect(() => {
    if (selection.length === 1) scrollRowIntoView(scrollRef.current, `[data-unit="${CSS.escape(selection[0])}"]`);
  }, [selection]);

  const onRowClick = (e: MouseEvent, r: Row) => {
    const { select, requestFocus } = store();
    select([r.unit.id], e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
    if (r.placement) requestFocus(r.unit.id);
  };

  const place = (r: Row) => {
    const { toast, plan: committed } = store();
    const vehicleId = targetVehicleId(r.unit.spec);
    const bulk = isBulkLiquid(r.unit.spec);
    if (!vehicleId) {
      toast(bulk ? `${r.unit.spec.name} needs a tanker: add one to this plan` : `No box or flatbed vehicle for ${r.unit.spec.name} in this plan`, 'error');
      return;
    }
    const name = committed.vehicles.find((v) => v.id === vehicleId)?.name ?? 'the vehicle';
    if (placeOnVehicle([r.unit.id], vehicleId)) toast(`Placed ${r.unit.spec.name} on ${name}`, 'success');
    else toast(bulk ? `No free compartment on ${name} can take ${r.unit.spec.name}` : `No legal space for ${r.unit.spec.name} on ${name}`, 'error');
  };

  const duplicate = (r: Row) => {
    const id = store().duplicateLine(r.line.id);
    if (id) {
      store().setHighlightLines([id]);
      store().toast(`Duplicated ${r.unit.spec.name} (${r.line.quantity} unit${r.line.quantity === 1 ? '' : 's'}, unplaced)`, 'success');
    }
  };

  const remove = (r: Row) => {
    store().removeLines([r.line.id]);
    store().toast(`Deleted ${r.unit.spec.name} (${r.line.quantity} unit${r.line.quantity === 1 ? '' : 's'}). Ctrl+Z to undo`, 'info');
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));

  const totalKg = ev.totalKg;

  return (
    <Card className="flex shrink-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <CardHeader
          icon={<List />}
          className="mr-auto"
          title={
            <span>
              Items{' '}
              <span className="font-normal text-muted">
                · <span className="font-mono num">{ev.units.length}</span> units in <span className="font-mono num">{plan.lines.length}</span> lines · <span className="font-mono num">{formatWeight(totalKg, sys)}</span>
              </span>
            </span>
          }
        />
        <div className="relative w-64 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => store().setSearch(e.target.value)}
            placeholder="Search name, SKU, customer, stop"
            aria-label="Search items"
            className={`${inputClass} h-8 pl-8 pr-8`}
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => store().setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => store().openDialog('itemEditor', { mode: 'create' })}>
          New item
        </Button>
        <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => store().openDialog('import', true)}>
          Import CSV
        </Button>
        <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} disabled={!plan.lines.length} onClick={() => downloadItemsCsv(store().plan)}>
          Export CSV
        </Button>
      </div>

      <div role="tablist" aria-label="Item filters" className="flex gap-1 overflow-x-auto border-b border-line px-3">
        {tabs.map((t) => {
          const count = rows.filter((r) => inTab(r, t.key, activeId, secondId)).length;
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => store().setTableTab(t.key)}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {t.label}
              <span className={`rounded-full px-1.5 font-mono num text-[10.5px] ${active ? 'bg-accent-soft text-accent-strong' : 'bg-black/5 text-muted'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {plan.lines.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="text-sm font-medium text-ink">No items in this plan yet</p>
          <p className="max-w-md text-xs text-muted">Add cargo with dimensions, weight and handling rules, start from one of the templates, or import a spreadsheet.</p>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => store().openDialog('itemEditor', { mode: 'create' })}>
              New item
            </Button>
            <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => store().openDialog('import', true)}>
              Import CSV
            </Button>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="relative max-h-[440px] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                {COLUMNS.map((c) => {
                  const dir = sort?.key === c.key ? sort.dir : 0;
                  return (
                    <th key={c.key} scope="col" aria-sort={dir === 1 ? 'ascending' : dir === -1 ? 'descending' : 'none'} className={`border-b border-line px-2 py-1.5 text-left font-medium text-muted first:pl-4 ${c.className ?? ''}`}>
                      <button type="button" onClick={() => toggleSort(c.key)} className={`inline-flex items-center gap-1 whitespace-nowrap rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${dir ? 'text-ink' : ''}`}>
                        {c.label}
                        {dir === 1 ? <ArrowUp className="h-3 w-3" /> : dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </button>
                    </th>
                  );
                })}
                <th scope="col" className="border-b border-line px-2 py-1.5 pr-4 text-right font-medium text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const { unit, line, placement } = r;
                const s = unit.spec;
                const isSel = selected.has(unit.id);
                const isHi = highlighted.has(line.id);
                const isHover = hoverUnitId === unit.id;
                const bg = isSel ? 'bg-info-soft' : isHi ? 'bg-accent-soft' : isHover ? 'bg-canvas' : '';
                const cell = 'border-b border-line px-2 py-1.5 whitespace-nowrap';
                return (
                  <tr
                    key={unit.id}
                    data-unit={unit.id}
                    data-line={line.id}
                    aria-selected={isSel}
                    draggable={!placement && !locked}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-cargo-unit', unit.id);
                      e.dataTransfer.setData('text/plain', s.name);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onMouseEnter={() => store().setHover(unit.id)}
                    onMouseLeave={() => store().setHover(null)}
                    onClick={(e) => onRowClick(e, r)}
                    className={`cursor-pointer transition-colors duration-700 ${bg} ${!placement && !locked ? 'active:cursor-grabbing' : ''}`}
                  >
                    <td className={`${cell} pl-4`}>
                      <div className="flex items-center gap-2">
                        {!placement && <GripVertical aria-hidden className="-ml-3 h-3.5 w-3.5 shrink-0 cursor-grab text-muted" />}
                        <ColorDot color={s.color ?? r.color} />
                        <span className="max-w-56 truncate font-medium text-ink" title={s.name}>
                          {s.name}
                        </span>
                        {line.quantity > 1 && (
                          <span className="font-mono num text-[10.5px] text-muted">
                            {unit.index + 1}/{line.quantity}
                          </span>
                        )}
                        {placement?.pinned && <Pin aria-label="Pinned" className="h-3 w-3 text-accent-strong" />}
                      </div>
                    </td>
                    <td className={`${cell} font-mono text-ink-soft`}>{s.sku || '-'}</td>
                    <td className={`${cell} text-ink-soft`}>{s.origin || '-'}</td>
                    <td className={`${cell} text-ink-soft`}>{s.category || '-'}</td>
                    <td className={`${cell} text-right`}>
                      <InlineNumber display={line.quantity} value={line.quantity} digits={0} min={1} label="Quantity" disabled={locked} onCommit={(n) => store().updateLine(line.id, { quantity: Math.round(n) })} />
                      {s.liquid ? (
                        <div className="max-w-40 truncate text-[10.5px] text-muted" title={s.liquid.name}>
                          {formatLitres(s.liquid.volumeL, sys, 0)} {s.liquid.name}
                        </div>
                      ) : (
                        line.contents && <div className="max-w-32 truncate text-[10.5px] text-muted" title={line.contents}>{line.contents}</div>
                      )}
                    </td>
                    <td className={`${cell} font-mono num text-ink-soft`}>{isBulkLiquid(s) ? <span className="text-muted" title="Bulk fill: carried in a tanker compartment">—</span> : formatDims(s.dims, sys)}</td>
                    <td className={`${cell} text-right`}>
                      {s.liquid ? (
                        <span className="px-1 font-mono num" title="Calculated: volume × density + container">
                          {formatWeight(s.weightKg, sys)}
                        </span>
                      ) : (
                        <InlineNumber
                          display={formatWeight(s.weightKg, sys)}
                          value={fromKg(s.weightKg, wUnit)}
                          digits={1}
                          min={Number.MIN_VALUE}
                          label={`Weight per unit (${wUnit})`}
                          disabled={locked}
                          onCommit={(n) => store().updateLine(line.id, { spec: { weightKg: toKg(n, wUnit) } })}
                        />
                      )}
                    </td>
                    <td className={`${cell} font-mono num text-ink-soft`}>
                      {activeTanker && isBulkLiquid(s) && (!placement || placement.vehicleId === activeTanker.id) ? (
                        <CompartmentCell plan={plan} vehicle={activeTanker} unitId={unit.id} current={placement?.compartmentId} disabled={locked} />
                      ) : placement ? (
                        <>
                          {plan.vehicles.length > 1 && <span className="text-muted">T{r.vehicleIndex + 1} · </span>}
                          {r.bay}
                        </>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className={cell}>
                      <span className="flex items-center gap-1.5 text-ink-soft">
                        <ColorDot color={r.color} size={8} />
                        <span className="max-w-36 truncate">{r.customer?.name ?? '-'}</span>
                      </span>
                    </td>
                    <td className={cell}>
                      <StopCell row={r} stops={plan.stops} customers={plan.customers} disabled={locked} onChange={(stopId) => store().updateLine(line.id, { stopId })} />
                    </td>
                    <td className={cell}>
                      {s.temp === 'ambient' ? (
                        <span className="text-muted">Ambient</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium" style={{ color: TEMP_COLORS[s.temp] }}>
                          <ColorDot color={TEMP_COLORS[s.temp]} size={7} />
                          {TEMP_LABELS[s.temp]}
                        </span>
                      )}
                    </td>
                    <td className={cell}>
                      {s.hazmat ? (
                        <span className="inline-flex items-center gap-1.5" title={`Class ${s.hazmat.hazClass} · ${HAZMAT_CLASS_NAMES[s.hazmat.hazClass] ?? ''}${s.hazmat.packingGroup ? ` · PG ${s.hazmat.packingGroup}` : ''}`}>
                          <span className="inline-grid h-4 min-w-6 place-items-center rounded px-1 font-mono text-[10px] font-bold text-white" style={{ background: hazmatColor(s.hazmat.hazClass) }}>
                            {s.hazmat.hazClass}
                          </span>
                          <span className="font-mono text-ink-soft">{s.hazmat.unNumber}</span>
                        </span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className={cell}>
                      <span title={ev.violationsByUnit.get(unit.id)?.map((v) => v.message).join('\n')}>
                        <UnitStatusChip status={r.status} />
                      </span>
                    </td>
                    <td className={`${cell} pr-4`} onClick={stopPropagation}>
                      <div className="flex items-center justify-end gap-0.5">
                        {placement ? (
                          <>
                            <IconButton size="sm" label={placement.pinned ? 'Unpin' : 'Pin (optimiser keeps it)'} active={placement.pinned} disabled={locked} onClick={() => store().togglePin(unit.id)}>
                              {placement.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                            </IconButton>
                            <IconButton size="sm" label="Remove from vehicle" disabled={locked} onClick={() => store().unplaceUnits([unit.id])}>
                              <PackageMinus className="h-3.5 w-3.5" />
                            </IconButton>
                          </>
                        ) : (
                          <IconButton size="sm" label="Place on a vehicle (active vehicle first)" disabled={locked} onClick={() => place(r)}>
                            <PackagePlus className="h-3.5 w-3.5" />
                          </IconButton>
                        )}
                        <IconButton size="sm" label="Edit line" disabled={locked} onClick={() => store().openDialog('itemEditor', { mode: 'edit', lineId: line.id })}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton size="sm" label="Duplicate line" disabled={locked} onClick={() => duplicate(r)}>
                          <Copy className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton size="sm" label="Delete line" disabled={locked} onClick={() => remove(r)} className="hover:text-bad">
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center text-xs text-muted">
              {q ? (
                <>
                  No units match “{search}”{tab !== 'all' ? ' in this tab' : ''}.
                  <Button size="sm" variant="ghost" onClick={() => store().setSearch('')}>
                    Clear search
                  </Button>
                </>
              ) : tab === 'unplaced' ? (
                'Every unit is on a vehicle.'
              ) : tab === 'hazmat' ? (
                'No dangerous goods in this plan.'
              ) : tab === 'temperature' ? (
                'No chilled or frozen items in this plan.'
              ) : (
                'No units on this vehicle yet. Place items from the Unplaced tab or run Optimise.'
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Scrolls a row inside the table's own scroll container (never the page). */
function scrollRowIntoView(container: HTMLElement | null, selector: string) {
  const row = container?.querySelector<HTMLElement>(selector);
  if (!container || !row) return;
  const head = container.querySelector('thead')?.getBoundingClientRect().height ?? 0;
  const top = row.offsetTop - head;
  const bottom = row.offsetTop + row.offsetHeight;
  if (top < container.scrollTop) container.scrollTo({ top, behavior: 'smooth' });
  else if (bottom > container.scrollTop + container.clientHeight) container.scrollTo({ top: bottom - container.clientHeight, behavior: 'smooth' });
}
