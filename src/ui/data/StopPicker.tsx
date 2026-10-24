import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import type { Id } from '../../domain/types';
import { useStore } from '../../state/store';
import { Button } from '../common/Button';
import { ColorDot } from '../common/Chip';
import { inputClass, TextInput } from '../common/fields';

const NEW = '__new__';

/** Delivery-stop select with an inline "New stop…" form (creates the stop through addStop). */
export function StopPicker({ value, onChange, invalid }: { value: Id; onChange: (stopId: Id) => void; invalid?: boolean }) {
  const stops = useStore((s) => s.plan.stops);
  const customers = useStore((s) => s.plan.customers);
  const addStop = useStore((s) => s.addStop);
  const [creating, setCreating] = useState(stops.length === 0);
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const listId = useId();
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const color = customers.find((c) => c.id === stops.find((s) => s.id === value)?.customerId)?.color;

  const create = () => {
    const stopName = name.trim() || customer.trim();
    if (!stopName) return;
    const id = addStop({ name: stopName, customerName: customer.trim() || stopName });
    onChange(id);
    setCreating(false);
    setName('');
    setCustomer('');
  };

  if (creating) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-canvas p-2">
        <div className="flex gap-1.5">
          <TextInput placeholder="Stop name / address" value={name} onChange={(e) => setName(e.target.value)} aria-label="New stop name" autoFocus />
          <TextInput
            placeholder="Customer"
            list={listId}
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), create())}
            aria-label="Customer"
          />
          <datalist id={listId}>
            {customers.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </div>
        <div className="flex justify-end gap-1.5">
          {stops.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          )}
          <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} disabled={!name.trim() && !customer.trim()} onClick={create}>
            Add stop {stops.length + 1}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {color && <ColorDot color={color} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />}
      <select
        value={value}
        aria-invalid={invalid}
        aria-label="Delivery stop"
        onChange={(e) => (e.target.value === NEW ? setCreating(true) : onChange(e.target.value))}
        className={`${inputClass} pr-7 ${color ? 'pl-7' : ''} ${invalid ? 'border-bad' : ''}`}
      >
        {!stops.some((s) => s.id === value) && <option value="">Choose a stop…</option>}
        {sorted.map((s) => (
          <option key={s.id} value={s.id}>
            {s.sequence} · {s.name} ({customers.find((c) => c.id === s.customerId)?.name ?? 'no customer'})
          </option>
        ))}
        <option value={NEW}>New stop…</option>
      </select>
    </div>
  );
}
