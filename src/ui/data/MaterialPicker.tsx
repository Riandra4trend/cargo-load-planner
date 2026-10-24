import { Search } from 'lucide-react';
import { useState } from 'react';
import { TEMP_COLORS, TEMP_LABELS, hazmatColor } from '../../domain/colors';
import { CUSTOM_MATERIAL_ID, MATERIAL_CATEGORY_LABELS, MATERIAL_LIBRARY, materialColor, type MaterialCategory, type MaterialDef } from '../../domain/materials';
import type { MaterialState, UnitSystem } from '../../domain/types';
import { formatMaterialDensity } from '../../domain/units';
import { Button } from '../common/Button';
import { Chip, ColorDot } from '../common/Chip';
import { inputClass, TextInput } from '../common/fields';

const CATEGORIES = Object.keys(MATERIAL_CATEGORY_LABELS) as MaterialCategory[];

/** Categories holding materials of a state, in library order. */
export const categoriesOf = (state?: MaterialState): MaterialCategory[] => CATEGORIES.filter((c) => MATERIAL_LIBRARY.some((m) => m.category === c && (!state || m.state === state)));

/** Hazmat class chip + UN number, food, temperature and pressure badges of a material. */
export function MaterialBadges({ def }: { def: MaterialDef }) {
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

/** Native material select grouped by category (liquids and dry bulk), with a trailing "Custom material…" option. */
export function MaterialSelect({ value, onChange, label = 'Material', className = '' }: { value: string; onChange: (materialId: string) => void; label?: string; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={`${inputClass} pr-7 ${className}`}>
      {CATEGORIES.map((c) => (
        <optgroup key={c} label={MATERIAL_CATEGORY_LABELS[c]}>
          {MATERIAL_LIBRARY.filter((m) => m.category === c).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
      <option value={CUSTOM_MATERIAL_ID}>Custom material…</option>
    </select>
  );
}

/** Searchable material list grouped by category: liquids then dry bulk, with density, hazmat, food and temperature. */
export function MaterialPicker({ value, onPick, sys }: { value: string; onPick: (materialId: string) => void; sys: UnitSystem }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = q
    ? MATERIAL_LIBRARY.filter((m) => [m.name, m.hazmat?.unNumber ?? '', MATERIAL_CATEGORY_LABELS[m.category], m.state === 'solid' ? 'dry bulk' : 'liquid'].some((s) => s.toLowerCase().includes(q)))
    : MATERIAL_LIBRARY;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <TextInput className="pl-8" placeholder={`Search ${MATERIAL_LIBRARY.length} materials (name, UN number, category)`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search materials" autoFocus />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-line" role="listbox" aria-label="Materials">
        {CATEGORIES.map((c) => {
          const items = list.filter((m) => m.category === c);
          if (!items.length) return null;
          return (
            <div key={c} role="group" aria-label={MATERIAL_CATEGORY_LABELS[c]}>
              <div className="sticky top-0 z-10 flex border-b border-line bg-canvas px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <span className="flex-1">{MATERIAL_CATEGORY_LABELS[c]}</span>
                <span className="font-normal normal-case">{items[0].state === 'solid' ? 'dry bulk' : 'liquid'}</span>
              </div>
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={m.id === value}
                  onClick={() => onPick(m.id)}
                  className={`flex w-full items-center gap-2 border-b border-line px-3 py-1.5 text-left last:border-b-0 hover:bg-canvas focus-visible:bg-accent-soft focus-visible:outline-none ${m.id === value ? 'bg-accent-soft' : ''}`}
                >
                  <ColorDot color={m.color} className="ring-1 ring-black/10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{m.name}</span>
                    {m.note && <span className="block truncate text-[11px] text-muted">{m.note}</span>}
                  </span>
                  <span className="shrink-0 font-mono num text-xs text-ink-soft">{formatMaterialDensity(m.densityKgPerL, m.state, sys)}</span>
                  <MaterialBadges def={m} />
                </button>
              ))}
            </div>
          );
        })}
        {list.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted">No material matches “{query}”.</p>}
      </div>
      <Button size="sm" variant={value === CUSTOM_MATERIAL_ID ? 'primary' : 'secondary'} onClick={() => onPick(CUSTOM_MATERIAL_ID)} className="self-start">
        <ColorDot color={materialColor(CUSTOM_MATERIAL_ID)} /> Custom material…
      </Button>
    </div>
  );
}
