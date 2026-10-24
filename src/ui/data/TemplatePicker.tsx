import { Droplet, Search, Snowflake, Thermometer, Trash2, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import { TEMP_COLORS, TEMP_LABELS, hazmatColor } from '../../domain/colors';
import { isBulkLiquid } from '../../domain/geometry';
import { liquidColor } from '../../domain/liquids';
import { formatDims, formatLitres, formatWeight } from '../../domain/units';
import type { ItemTemplate } from '../../domain/types';
import { useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { IconButton } from '../common/Button';
import { Chip } from '../common/Chip';
import { TextInput } from '../common/fields';

/** User library first, then the built-in templates. */
export function useAllTemplates(): ItemTemplate[] {
  const library = useStore((s) => s.library);
  return useMemo(() => [...library, ...BUILT_IN_TEMPLATES], [library]);
}

/** Display group of a template: saved by the user, liquids, or general freight. */
export function templateGroup(t: ItemTemplate): 'Saved' | 'Liquids' | 'General freight' {
  if (!t.builtIn) return 'Saved';
  return t.spec.liquid ? 'Liquids' : 'General freight';
}

export const TEMPLATE_GROUPS = ['Saved', 'General freight', 'Liquids'] as const;

const matches = (t: ItemTemplate, q: string) =>
  [t.spec.name, t.spec.sku, t.spec.category, t.spec.origin, t.spec.hazmat?.unNumber ?? '', t.contents ?? '', t.spec.liquid?.name ?? ''].some((s) => s.toLowerCase().includes(q));

/** Searchable list of built-in and saved templates, grouped (saved, general freight, liquids). */
export function TemplatePicker({ onPick, className = '' }: { onPick: (template: ItemTemplate) => void; className?: string }) {
  const sys = useUnitSystem();
  const removeTemplate = useStore((s) => s.removeTemplate);
  const all = useAllTemplates();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = q ? all.filter((t) => matches(t, q)) : all;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <TextInput className="pl-8" placeholder={`Search ${all.length} templates (name, SKU, category, UN, liquid…)`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search templates" autoFocus />
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-line" role="listbox" aria-label="Templates">
        {list.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted">No template matches “{query}”.</p>}
        {TEMPLATE_GROUPS.map((group) => {
          const items = list.filter((t) => templateGroup(t) === group);
          if (!items.length) return null;
          return (
            <div key={group} role="group" aria-label={group}>
              <div className="sticky top-0 z-10 border-b border-line bg-canvas px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{group}</div>
              <ul>
                {items.map((t) => (
                  <li key={t.id} className="group flex items-center border-b border-line last:border-b-0 hover:bg-canvas">
                    <button type="button" role="option" aria-selected={false} onClick={() => onPick(t)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left focus-visible:bg-accent-soft focus-visible:outline-none">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{t.spec.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {[t.spec.category, t.contents].filter(Boolean).join(' · ')}
                          {t.spec.category || t.contents ? ' · ' : ''}
                          <span className="font-mono num">
                            {isBulkLiquid(t.spec) ? 'tanker fill' : formatDims(t.spec.dims, sys)} · {formatWeight(t.spec.weightKg, sys)}
                          </span>
                        </span>
                      </span>
                      {t.spec.liquid && (
                        <Chip className="shrink-0" title={t.spec.liquid.name}>
                          <Droplet className="h-3 w-3" style={{ color: liquidColor(t.spec.liquid.liquidId) }} />
                          {formatLitres(t.spec.liquid.volumeL, sys, 0)}
                        </Chip>
                      )}
                      {t.spec.temp !== 'ambient' && (
                        <Chip className="shrink-0" title={TEMP_LABELS[t.spec.temp]}>
                          {t.spec.temp === 'frozen' ? <Snowflake className="h-3 w-3" style={{ color: TEMP_COLORS.frozen }} /> : <Thermometer className="h-3 w-3" style={{ color: TEMP_COLORS.chilled }} />}
                          {TEMP_LABELS[t.spec.temp]}
                        </Chip>
                      )}
                      {t.spec.hazmat && (
                        <Chip className="shrink-0" title={`Class ${t.spec.hazmat.hazClass}`}>
                          <TriangleAlert className="h-3 w-3" style={{ color: hazmatColor(t.spec.hazmat.hazClass) }} />
                          {t.spec.hazmat.unNumber}
                        </Chip>
                      )}
                    </button>
                    {!t.builtIn && (
                      <IconButton label={`Delete template ${t.spec.name}`} size="sm" className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => removeTemplate(t.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
