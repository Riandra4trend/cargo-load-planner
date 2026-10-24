import { Search } from 'lucide-react';
import { useState } from 'react';
import { TEMP_COLORS, TEMP_LABELS, hazmatColor } from '../../domain/colors';
import { CUSTOM_LIQUID_ID, LIQUIDS, liquidColor, type LiquidCategory, type LiquidDef } from '../../domain/liquids';
import { formatLiquidDensity } from '../../domain/units';
import type { UnitSystem } from '../../domain/types';
import { Button } from '../common/Button';
import { Chip, ColorDot } from '../common/Chip';
import { inputClass, TextInput } from '../common/fields';

export const LIQUID_CATEGORY_LABELS: Record<LiquidCategory, string> = {
  water: 'Water',
  fuel: 'Fuels',
  oil: 'Oils',
  food: 'Food liquids',
  chemical: 'Chemicals',
  gas: 'Liquefied gas',
};

const CATEGORIES = Object.keys(LIQUID_CATEGORY_LABELS) as LiquidCategory[];

/** Hazmat class chip + UN number, food, temperature and pressure badges of a liquid. */
export function LiquidBadges({ def }: { def: LiquidDef }) {
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1">
      {def.hazmat && (
        <span className="inline-flex items-center gap-1" title={`Class ${def.hazmat.hazClass}`}>
          <span className="inline-grid h-4 min-w-6 place-items-center rounded px-1 font-mono text-[10px] font-bold text-white" style={{ background: hazmatColor(def.hazmat.hazClass) }}>
            {def.hazmat.hazClass}
          </span>
          <span className="font-mono text-[11px] text-ink-soft">{def.hazmat.unNumber}</span>
        </span>
      )}
      {def.isFood && <Chip tone="ok">Food</Chip>}
      {def.temp !== 'ambient' && (
        <Chip>
          <ColorDot color={TEMP_COLORS[def.temp]} size={7} />
          {TEMP_LABELS[def.temp]}
        </Chip>
      )}
      {def.pressurised && <Chip tone="warn">Pressure tank</Chip>}
    </span>
  );
}

/** Native liquid select grouped by category, with a trailing "Custom liquid…" option. */
export function LiquidSelect({ value, onChange, label = 'Liquid', className = '' }: { value: string; onChange: (liquidId: string) => void; label?: string; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={`${inputClass} pr-7 ${className}`}>
      {CATEGORIES.map((c) => (
        <optgroup key={c} label={LIQUID_CATEGORY_LABELS[c]}>
          {LIQUIDS.filter((l) => l.category === c).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </optgroup>
      ))}
      <option value={CUSTOM_LIQUID_ID}>Custom liquid…</option>
    </select>
  );
}

/** Searchable liquid list grouped by category (density, hazmat, food and temperature shown). */
export function LiquidPicker({ value, onPick, sys }: { value: string; onPick: (liquidId: string) => void; sys: UnitSystem }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = q ? LIQUIDS.filter((l) => [l.name, l.hazmat?.unNumber ?? '', LIQUID_CATEGORY_LABELS[l.category]].some((s) => s.toLowerCase().includes(q))) : LIQUIDS;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <TextInput className="pl-8" placeholder={`Search ${LIQUIDS.length} liquids (name, UN number, category)`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search liquids" autoFocus />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-line" role="listbox" aria-label="Liquids">
        {CATEGORIES.map((c) => {
          const items = list.filter((l) => l.category === c);
          if (!items.length) return null;
          return (
            <div key={c} role="group" aria-label={LIQUID_CATEGORY_LABELS[c]}>
              <div className="sticky top-0 z-10 border-b border-line bg-canvas px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{LIQUID_CATEGORY_LABELS[c]}</div>
              {items.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="option"
                  aria-selected={l.id === value}
                  onClick={() => onPick(l.id)}
                  className={`flex w-full items-center gap-2 border-b border-line px-3 py-1.5 text-left last:border-b-0 hover:bg-canvas focus-visible:bg-accent-soft focus-visible:outline-none ${l.id === value ? 'bg-accent-soft' : ''}`}
                >
                  <ColorDot color={l.color} className="ring-1 ring-black/10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{l.name}</span>
                    {l.note && <span className="block truncate text-[11px] text-muted">{l.note}</span>}
                  </span>
                  <span className="shrink-0 font-mono num text-xs text-ink-soft">{formatLiquidDensity(l.densityKgPerL, sys)}</span>
                  <LiquidBadges def={l} />
                </button>
              ))}
            </div>
          );
        })}
        {list.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted">No liquid matches “{query}”.</p>}
      </div>
      <Button size="sm" variant={value === CUSTOM_LIQUID_ID ? 'primary' : 'secondary'} onClick={() => onPick(CUSTOM_LIQUID_ID)} className="self-start">
        <ColorDot color={liquidColor(CUSTOM_LIQUID_ID)} /> Custom liquid…
      </Button>
    </div>
  );
}
