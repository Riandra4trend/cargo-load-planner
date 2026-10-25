import { Box, Boxes, Container, Cylinder, Disc3, Droplet, FilePlus2, Fuel, Minus, MoveHorizontal, Mountain, Package, Plus, Search, Truck, Upload, X, type LucideIcon } from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { isBulk } from '../../domain/geometry';
import { materialColor, withMaterialVolume } from '../../domain/materials';
import { VEHICLE_PRESETS, type PresetCategory } from '../../domain/presets';
import type { Id, ItemSpec, ItemTemplate, PackagingKind } from '../../domain/types';
import { formatDims, formatMaterialVolume, formatWeight } from '../../domain/units';
import { proposeVehicles } from '../../packing';
import { useActiveVehicle } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Button, IconButton } from '../common/Button';
import { CARGO_TEMPLATE_MIME, type TemplateDragData } from '../common/dragTypes';
import { inputClass, MaterialVolumeInput, TextInput } from '../common/fields';
import { bulkCardDefault, vehicleSuits, type BulkCardDefault } from './itemChecks';
import { addCargoToVehicle } from './placement';
import { StopPicker } from './StopPicker';
import { TEMPLATE_GROUPS, templateGroup, useAllTemplates } from './TemplatePicker';

const PALLETS: Partial<Record<PackagingKind, true>> = { 'eur-pallet': true, 'eur-half': true, 'industrial-pallet': true, 'us-pallet': true };

/** Icon by packaging / shape: pallets, cartons, crates, drums, IBCs, jerrycans, rolls, long goods; a drop or heap for bulk. */
function iconFor(spec: ItemSpec): LucideIcon {
  if (isBulk(spec)) return spec.material?.state === 'solid' ? Mountain : Droplet;
  if (PALLETS[spec.packaging]) return Boxes;
  switch (spec.packaging) {
    case 'carton':
      return Package;
    case 'crate':
      return Box;
    case 'drum':
      return Cylinder;
    case 'ibc':
      return Container;
    case 'jerrycan':
      return Fuel;
    case 'long-goods':
      return MoveHorizontal;
    default:
      return spec.shape === 'cylinder-lying' ? Disc3 : spec.shape === 'cylinder-upright' ? Cylinder : Package;
  }
}

/** Which kind of vehicle a spec needs, for messages and the fallback preset category. */
function neededVehicle(spec: ItemSpec): { label: string; category: PresetCategory } {
  if (!isBulk(spec)) return { label: 'box truck or flatbed', category: 'truck' };
  return spec.material?.state === 'solid' ? { label: 'dump truck', category: 'tipper' } : { label: 'tanker', category: 'tanker' };
}

interface Mismatch {
  templateId: Id;
  presetId: string;
  presetName: string;
  needed: string;
}

/**
 * Cargo palette: add templates straight into the active vehicle (or drag a card onto the 3D truck).
 * Rendered by the shell as a drawer; `onClose` hides it (Esc or ✕).
 */
export function CargoPalette({ onClose }: { onClose: () => void }) {
  const plan = useStore((s) => s.plan);
  const vehicle = useActiveVehicle();
  const templates = useAllTemplates();
  const sys = plan.settings.units;
  const [query, setQuery] = useState('');
  const [chosenStop, setStopId] = useState<Id>('');
  const [quantities, setQuantities] = useState<Record<Id, number>>({});
  /** Bulk fill volumes the user typed, keyed by `${vehicleId}:${templateId}` so defaults follow the active vehicle. */
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [mismatch, setMismatch] = useState<Mismatch | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // The palette stays open across plan changes (new / loaded plans): fall back to the first stop when the chosen one is gone.
  const stopId = plan.stops.some((s) => s.id === chosenStop) ? chosenStop : ([...plan.stops].sort((a, b) => a.sequence - b.sequence)[0]?.id ?? '');
  const stopValid = stopId !== '';
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const words = q.split(/\s+/).filter(Boolean);
    const list = words.length
      ? templates.filter((t) => {
          const hay = [t.spec.name, t.spec.sku, t.spec.category, t.contents ?? '', t.spec.material?.name ?? '', t.spec.hazmat?.unNumber ?? '', templateGroup(t)].join(' ').toLowerCase();
          return words.every((w) => hay.includes(w));
        })
      : templates;
    return TEMPLATE_GROUPS.flatMap((g) => list.filter((t) => templateGroup(t) === g).map((t) => ({ t, group: g })));
  }, [templates, q]);

  /** Bulk cards: default fill per template for the active vehicle (capped at its best free compartment's legal max). */
  const bulkDefaults = useMemo(() => {
    const map: Record<Id, BulkCardDefault> = {};
    for (const t of templates) if (isBulk(t.spec)) map[t.id] = bulkCardDefault(plan, vehicle, t.spec);
    return map;
  }, [templates, plan, vehicle]);

  const qtyOf = (id: Id) => quantities[id] ?? 1;
  const setQty = (id: Id, n: number) => setQuantities((m) => ({ ...m, [id]: Math.min(999, Math.max(1, Math.round(n) || 1)) }));
  const volumeOf = (t: ItemTemplate) => volumes[`${vehicle.id}:${t.id}`] ?? bulkDefaults[t.id]?.volumeL ?? t.spec.material?.volumeL ?? 0;
  const setVolume = (t: ItemTemplate, litres: number) => setVolumes((m) => ({ ...m, [`${vehicle.id}:${t.id}`]: litres }));
  /** The spec a card adds: bulk templates with the chosen fill volume (weight recomputed), others unchanged. */
  const specOf = (t: ItemTemplate): ItemSpec => (isBulk(t.spec) ? withMaterialVolume(t.spec, volumeOf(t)) : t.spec);
  const focusCard = (i: number) => cardRefs.current[Math.max(0, Math.min(visible.length - 1, i))]?.focus();

  const load = (t: ItemTemplate, vehicleId: Id) => {
    const { plan: current, setHighlightLines, select, setActiveVehicle, toast } = useStore.getState();
    const quantity = qtyOf(t.id);
    const spec = specOf(t);
    const result = addCargoToVehicle(spec, quantity, stopId, vehicleId, { contents: t.contents });
    const name = current.vehicles.find((v) => v.id === vehicleId)?.name.split(' · ')[0] ?? 'the vehicle';
    const what = spec.material && isBulk(spec) ? `${formatMaterialVolume(spec.material.volumeL, spec.material.state, sys)} ${spec.name}` : spec.name;
    setActiveVehicle(vehicleId);
    setHighlightLines([result.lineId]);
    setMismatch(null);
    // Select without moving the camera, so the forklift's trip from the warehouse stays in view.
    if (result.placed.length) select([result.placed[0]]);
    if (!result.unplaced.length) toast(`Added ${quantity} × ${what} to ${name}`, 'success');
    else if (result.placed.length) toast(`${result.placed.length} placed, ${result.unplaced.length} didn't fit: Optimise or add a vehicle`, 'info');
    else toast(`${what} didn't fit on ${name}: added as unplaced. Optimise or add a vehicle`, 'error');
  };

  const add = (t: ItemTemplate) => {
    if (!stopValid) {
      useStore.getState().toast('Choose who it is delivered to first', 'error');
      return;
    }
    const { plan: current, ui } = useStore.getState();
    const suiting = current.vehicles.filter((v) => vehicleSuits(t.spec, v));
    const target = suiting.find((v) => v.id === ui.activeVehicleId) ?? suiting[0];
    if (target) return load(t, target.id);
    // No vehicle of the right kind: propose one (smallest legal preset for this line) to add in one click.
    const needed = neededVehicle(t.spec);
    const probe = { ...current, lines: [{ id: 'palette-probe', spec: specOf(t), quantity: qtyOf(t.id), stopId, priority: 'normal' as const }], placements: {} };
    const presetId = proposeVehicles(probe)[0] ?? VEHICLE_PRESETS.find((p) => p.category === needed.category)?.id;
    if (!presetId) return;
    setMismatch({ templateId: t.id, presetId, presetName: VEHICLE_PRESETS.find((p) => p.id === presetId)?.name ?? presetId, needed: needed.label });
  };

  const addVehicleAndLoad = (t: ItemTemplate, m: Mismatch) => {
    const vehicleId = useStore.getState().addVehicle(m.presetId);
    load(t, vehicleId);
  };

  const onDragStart = (e: DragEvent, t: ItemTemplate) => {
    const data: TemplateDragData = { templateId: t.id, quantity: qtyOf(t.id), stopId, ...(isBulk(t.spec) ? { volumeL: volumeOf(t) } : {}) };
    e.dataTransfer.setData(CARGO_TEMPLATE_MIME, JSON.stringify(data));
    e.dataTransfer.setData('text/plain', t.spec.name);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const onCardKey = (e: KeyboardEvent, t: ItemTemplate, i: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowDown') focusCard(i + 1);
    else if (e.key === 'ArrowUp') (i === 0 ? document.getElementById('cargo-palette-search')?.focus() : focusCard(i - 1));
    else if (e.key === 'Enter') add(t);
    else if (e.key === '+' || e.key === '=') setQty(t.id, qtyOf(t.id) + 1);
    else if (e.key === '-') setQty(t.id, qtyOf(t.id) - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      data-cargo-palette
      className="flex h-full min-h-0 w-full flex-col bg-card"
      role="dialog"
      aria-label={`Add cargo to ${vehicle.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex flex-col gap-2 border-b border-line px-3 pb-3 pt-2.5">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 shrink-0 text-accent-strong" aria-hidden />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={vehicle.name}>
            Add cargo to {vehicle.name.split(' · ')[0]}
          </h2>
          <IconButton label="Close cargo palette" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-ink-soft">Deliver to</span>
          <StopPicker value={stopId} onChange={setStopId} invalid={!stopValid} />
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <TextInput
            id="cargo-palette-search"
            className="pl-8"
            placeholder="Search pallets, drums, sand, diesel…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusCard(0);
              } else if (e.key === 'Enter' && visible[0]) {
                e.preventDefault();
                add(visible[0].t);
              }
            }}
            aria-label="Search cargo templates"
            autoFocus
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Cargo templates">
        {visible.length === 0 && <p className="px-3 py-8 text-center text-xs text-muted">No template matches “{query}”. Create a custom item below.</p>}
        {visible.map(({ t, group }, i) => {
          const Icon = iconFor(t.spec);
          const spec = specOf(t);
          const m = spec.material;
          const bulk = isBulk(spec) && !!m;
          const figures = m ? `${formatMaterialVolume(m.volumeL, m.state, sys)} · ${formatWeight(spec.weightKg, sys)}` : `${formatDims(spec.dims, sys)} · ${formatWeight(spec.weightKg, sys)}`;
          const suitsActive = vehicleSuits(t.spec, vehicle);
          const showGroup = i === 0 || visible[i - 1].group !== group;
          const qty = qtyOf(t.id);
          const fill = bulk ? bulkDefaults[t.id] : undefined;
          return (
            <div key={t.id} role="listitem">
              {showGroup && <div className="sticky top-0 z-10 border-b border-line bg-canvas px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{group}</div>}
              <div
                ref={(el) => {
                  cardRefs.current[i] = el;
                }}
                tabIndex={0}
                draggable
                onDragStart={(e) => onDragStart(e, t)}
                onKeyDown={(e) => onCardKey(e, t, i)}
                aria-label={`${t.spec.name}, ${figures}. Enter adds ${qty}.`}
                className="group flex cursor-grab flex-col gap-1.5 border-b border-line px-3 py-2 hover:bg-canvas focus-visible:bg-accent-soft focus-visible:outline-none active:cursor-grabbing"
              >
                <div className="flex items-start gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-canvas text-ink-soft group-hover:bg-card">
                    <Icon className="h-4.5 w-4.5" style={m ? { color: materialColor(m.materialId, m.state) } : undefined} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink" title={t.spec.name}>
                      {t.spec.name}
                    </span>
                    <span className="block truncate font-mono num text-[11px] text-muted" title={figures}>
                      {figures}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-1 pl-[2.625rem]">
                  {bulk && m ? (
                    <div className="mr-auto w-[6.5rem] shrink-0" title={`Volume per ${m.state === 'solid' ? 'load' : 'fill'}`}>
                      <MaterialVolumeInput litres={m.volumeL} onChange={(l) => setVolume(t, l)} state={m.state} sys={sys} className="h-6! text-xs" aria-label={`Volume of ${t.spec.name}`} />
                    </div>
                  ) : (
                    <span className="mr-auto truncate text-[11px] text-muted" title={suitsActive ? t.contents : `Needs a ${neededVehicle(t.spec).label}`}>
                      {suitsActive ? (t.contents ?? '') : `Needs a ${neededVehicle(t.spec).label}`}
                    </span>
                  )}
                  <IconButton label={`Fewer ${t.spec.name}`} size="sm" className="h-6! w-6!" disabled={qty <= 1} onClick={() => setQty(t.id, qty - 1)} tabIndex={-1}>
                    <Minus className="h-3.5 w-3.5" />
                  </IconButton>
                  {/* inputClass carries w-full; the wrapper fixes the stepper width. */}
                  <div className="w-10 shrink-0">
                    <input
                      value={qty}
                      inputMode="numeric"
                      onChange={(e) => setQty(t.id, Number(e.target.value))}
                      onFocus={(e) => e.target.select()}
                      aria-label={`Quantity of ${t.spec.name}`}
                      className={`${inputClass} num h-6! px-1 text-center text-xs`}
                    />
                  </div>
                  <IconButton label={`More ${t.spec.name}`} size="sm" className="h-6! w-6!" disabled={qty >= 999} onClick={() => setQty(t.id, qty + 1)} tabIndex={-1}>
                    <Plus className="h-3.5 w-3.5" />
                  </IconButton>
                  <Button size="sm" variant="primary" className="ml-1 h-6! px-2" disabled={bulk && !(volumeOf(t) > 0)} onClick={() => add(t)} aria-label={`Add ${qty} × ${t.spec.name}`}>
                    Add
                  </Button>
                </div>
                {fill && m && (
                  <div className="flex items-center gap-1.5 pl-[2.625rem] text-[11px]">
                    {fill.legal ? (
                      <>
                        <span className="truncate text-muted" title={`Legal max limited by ${fill.legal.limitedBy.toLowerCase()}`}>
                          Fits {fill.legal.label} · up to {formatMaterialVolume(fill.legal.litres, m.state, sys)} ({Math.round(fill.legal.pctOfCapacity)} %)
                        </span>
                        <button type="button" tabIndex={-1} className="ml-auto shrink-0 font-medium text-accent-strong hover:underline" onClick={() => setVolume(t, fill.legal!.litres)}>
                          Fill to max
                        </button>
                      </>
                    ) : (
                      <span className="truncate text-warn">{fill.problem}</span>
                    )}
                  </div>
                )}
                {mismatch?.templateId === t.id && (
                  <div className="ml-[2.625rem] flex flex-col gap-1.5 rounded-lg border border-warn/30 bg-warn-soft px-2.5 py-2 text-[11px] text-warn" role="status">
                    <span>
                      {t.spec.name} needs a {mismatch.needed}; this plan has none.
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="primary" className="h-auto! min-h-7 max-w-full whitespace-normal! py-1 text-left" icon={<Truck className="h-3.5 w-3.5 shrink-0" />} onClick={() => addVehicleAndLoad(t, mismatch)}>
                        Add a {mismatch.presetName.split(' (')[0]}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setMismatch(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="flex gap-2 border-t border-line px-3 py-2.5">
        <Button size="sm" className="flex-1" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => useStore.getState().openDialog('itemEditor', { mode: 'create', stopId: stopValid ? stopId : undefined })}>
          New custom item…
        </Button>
        <Button size="sm" className="flex-1" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => useStore.getState().openDialog('import', true)}>
          Import CSV…
        </Button>
      </footer>
    </div>
  );
}
