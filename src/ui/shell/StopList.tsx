import { ArrowDown, ArrowUp, Check, CornerDownLeft, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { STOP_PALETTE } from '../../domain/colors';
import { formatDistance, formatMass, KM_PER_MI } from '../../domain/units';
import type { Customer, Stop, UnitSystem } from '../../domain/types';
import { useEvaluation, useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Button, IconButton } from '../common/Button';
import { ColorDot } from '../common/Chip';
import { inputClass, NumberInput } from '../common/fields';

const DRAG_TYPE = 'application/x-stop-id';

/** Compact distance input in km (metric) or miles (imperial); `km` is always kilometres. */
function DistanceInput({ km, onChange, sys, label }: { km: number; onChange: (km: number) => void; sys: UnitSystem; label: string }) {
  return (
    <NumberInput
      aria-label={label}
      value={sys === 'metric' ? km : km / KM_PER_MI}
      onChange={(n) => onChange(sys === 'metric' ? n : n * KM_PER_MI)}
      min={0}
      digits={1}
      suffix={sys === 'metric' ? 'km' : 'mi'}
      className="!h-8 text-xs"
    />
  );
}

function StopEditor({ stop, customer, onDone }: { stop: Stop; customer: Customer | undefined; onDone: () => void }) {
  const commit = useStore((s) => s.commit);
  const sys = useUnitSystem();
  const [name, setName] = useState(stop.name);
  const [customerName, setCustomerName] = useState(customer?.name ?? '');
  const [color, setColor] = useState(customer?.color ?? STOP_PALETTE[0]);
  const [km, setKm] = useState(stop.distanceKm ?? 0);
  const save = (e: FormEvent) => {
    e.preventDefault();
    commit('Edit stop', (d) => {
      const s = d.stops.find((x) => x.id === stop.id);
      if (s && name.trim()) s.name = name.trim();
      if (s) s.distanceKm = km;
      const c = d.customers.find((x) => x.id === stop.customerId);
      if (c) {
        if (customerName.trim()) c.name = customerName.trim();
        c.color = color;
      }
    });
    onDone();
  };
  return (
    <form onSubmit={save} className="space-y-1.5 rounded-xl border border-line bg-canvas/70 p-2" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onDone())}>
      <input aria-label="Stop name" className={`${inputClass} !h-8 text-xs`} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <input aria-label="Customer name" className={`${inputClass} !h-8 text-xs`} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer" />
      <label className="flex items-center gap-2 text-[11px] text-muted">
        <span className="shrink-0">From previous stop</span>
        <DistanceInput km={km} onChange={setKm} sys={sys} label="Distance from the previous stop" />
      </label>
      <div role="radiogroup" aria-label="Stop colour" className="flex flex-wrap items-center gap-1">
        {STOP_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color.toLowerCase() === c.toLowerCase()}
            aria-label={`Colour ${c}`}
            onClick={() => setColor(c)}
            className={`h-5 w-5 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-accent ${color.toLowerCase() === c.toLowerCase() ? 'border-ink' : 'border-white'}`}
            style={{ background: c }}
          />
        ))}
        <label className="relative h-5 w-5 cursor-pointer overflow-hidden rounded-full border border-line-strong" title="Custom colour" style={{ background: color }}>
          <input type="color" aria-label="Custom colour" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
      </div>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" icon={<Check className="h-3.5 w-3.5" />}>
          Save
        </Button>
      </div>
    </form>
  );
}

function AddStopForm({ onDone }: { onDone: () => void }) {
  const addStop = useStore((s) => s.addStop);
  const sys = useUnitSystem();
  const [name, setName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [km, setKm] = useState(0);
  return (
    <form
      className="mt-1 space-y-1.5 rounded-xl border border-line bg-canvas/70 p-2"
      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onDone())}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        addStop({ name: name.trim(), customerName: customerName.trim() || name.trim(), distanceKm: km });
        onDone();
      }}
    >
      <input aria-label="New stop name" className={`${inputClass} !h-8 text-xs`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Stop name or address" autoFocus />
      <input aria-label="Customer" className={`${inputClass} !h-8 text-xs`} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer (existing or new)" />
      <label className="flex items-center gap-2 text-[11px] text-muted">
        <span className="shrink-0">From previous stop</span>
        <DistanceInput km={km} onChange={setKm} sys={sys} label="Distance from the previous stop" />
      </label>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
          Add stop
        </Button>
      </div>
    </form>
  );
}

/** The empty drive back to the depot after the last stop (counted in the fuel estimate). */
function ReturnLeg() {
  const sys = useUnitSystem();
  const returnKm = useStore((s) => s.plan.meta.returnKm);
  const updateMeta = useStore((s) => s.updateMeta);
  const [editing, setEditing] = useState(false);
  const [km, setKm] = useState(returnKm);
  if (editing)
    return (
      <form
        className="mt-0.5 flex items-center gap-1.5 rounded-xl border border-line bg-canvas/70 p-2"
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(false))}
        onSubmit={(e) => {
          e.preventDefault();
          updateMeta({ returnKm: km });
          setEditing(false);
        }}
      >
        <span className="shrink-0 text-[11px] text-muted">Back to depot</span>
        <DistanceInput km={km} onChange={setKm} sys={sys} label="Return distance to the depot" />
        <IconButton label="Save return distance" size="sm" variant="primary" type="submit" className="!h-8 !w-8 shrink-0">
          <Check className="h-3.5 w-3.5" />
        </IconButton>
      </form>
    );
  return (
    <div className="group flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-muted hover:bg-black/[0.03]">
      <CornerDownLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="flex-1 text-[11px]">Back to depot{returnKm > 0 ? ` · ${formatDistance(returnKm, sys)}` : ' · not counted'}</span>
      <IconButton
        label="Edit return distance"
        size="sm"
        className="!h-6 !w-6 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        onClick={() => {
          setKm(returnKm);
          setEditing(true);
        }}
      >
        <Pencil className="h-3 w-3" />
      </IconButton>
    </div>
  );
}

/** Delivery stops in route order: drag (or arrow buttons) to reorder, inline edit of name and colour, add/remove. */
export function StopList() {
  const sys = useUnitSystem();
  const evaluation = useEvaluation();
  const plan = evaluation.plan;
  const reorderStops = useStore((s) => s.reorderStops);
  const removeStop = useStore((s) => s.removeStop);
  const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const stops = useMemo(() => [...plan.stops].sort((a, b) => a.sequence - b.sequence), [plan.stops]);
  const customers = useMemo(() => new Map(plan.customers.map((c) => [c.id, c])), [plan.customers]);
  const totals = useMemo(() => {
    const m = new Map<string, { units: number; placed: number; kg: number }>();
    for (const u of evaluation.units) {
      const t = m.get(u.stopId) ?? { units: 0, placed: 0, kg: 0 };
      t.units += 1;
      t.kg += u.spec.weightKg;
      if (plan.placements[u.id]) t.placed += 1;
      m.set(u.stopId, t);
    }
    return m;
  }, [evaluation.units, plan.placements]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= stops.length || from === to) return;
    const ids = stops.map((s) => s.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    reorderStops(ids);
  };

  const finishDrop = () => {
    if (dragId !== null && dropIndex !== null) {
      const from = stops.findIndex((s) => s.id === dragId);
      move(from, dropIndex > from ? dropIndex - 1 : dropIndex);
    }
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <div>
      <ol className="space-y-0.5" aria-label="Delivery stops in route order" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropIndex(null)}>
        {stops.map((stop, i) => {
          const customer = customers.get(stop.customerId);
          const t = totals.get(stop.id);
          if (editing === stop.id)
            return (
              <li key={stop.id}>
                <StopEditor stop={stop} customer={customer} onDone={() => setEditing(null)} />
              </li>
            );
          return (
            <li
              key={stop.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, stop.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragId(stop.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropIndex(null);
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDropIndex(e.clientY < r.top + r.height / 2 ? i : i + 1);
              }}
              onDrop={(e) => {
                e.preventDefault();
                finishDrop();
              }}
              className={`group relative flex items-center gap-1.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-black/[0.03] ${dragId === stop.id ? 'opacity-40' : ''}`}
            >
              {dropIndex === i && <span className="absolute -top-px left-1 right-1 h-0.5 rounded bg-accent" aria-hidden />}
              {dropIndex === i + 1 && i === stops.length - 1 && <span className="absolute -bottom-px left-1 right-1 h-0.5 rounded bg-accent" aria-hidden />}
              <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted/60 group-hover:text-muted" aria-hidden />
              <span className="num w-3.5 shrink-0 text-center text-[11px] font-semibold text-muted">{stop.sequence}</span>
              <ColorDot color={customer?.color ?? '#999'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink" title={stop.name}>
                  {customer?.name ?? stop.name}
                </span>
                <span className="num block truncate text-[11px] text-muted" title={stop.name}>
                  {t ? `${t.placed === t.units ? t.units : `${t.placed}/${t.units}`} units · ${formatMass(t.kg, sys)}` : 'no items'}
                  {(stop.distanceKm ?? 0) > 0 && ` · ${formatDistance(stop.distanceKm ?? 0, sys)}`}
                </span>
              </span>
              <span className="absolute right-1 top-1/2 flex -translate-y-1/2 rounded-md bg-card opacity-0 shadow-sm ring-1 ring-line transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <IconButton label={`Move ${stop.name} earlier`} size="sm" className="!h-6 !w-6" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ArrowUp className="h-3 w-3" />
                </IconButton>
                <IconButton label={`Move ${stop.name} later`} size="sm" className="!h-6 !w-6" disabled={i === stops.length - 1} onClick={() => move(i, i + 1)}>
                  <ArrowDown className="h-3 w-3" />
                </IconButton>
                <IconButton label={`Edit ${stop.name}`} size="sm" className="!h-6 !w-6" onClick={() => setEditing(stop.id)}>
                  <Pencil className="h-3 w-3" />
                </IconButton>
                <IconButton
                  label={`Remove ${stop.name}`}
                  size="sm"
                  className="!h-6 !w-6"
                  onClick={() => {
                    if (!removeStop(stop.id)) toast(`${stop.name} still has items; move or delete them first`, 'error');
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </IconButton>
              </span>
            </li>
          );
        })}
      </ol>
      {stops.length > 0 && <ReturnLeg />}
      {adding ? (
        <AddStopForm onDone={() => setAdding(false)} />
      ) : (
        <Button size="sm" variant="ghost" className="mt-1" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
          Add stop
        </Button>
      )}
      {stops.length === 0 && !adding && (
        <p className="mt-1 text-[11px] text-muted">No stops yet. Add the first delivery stop.</p>
      )}
    </div>
  );
}
