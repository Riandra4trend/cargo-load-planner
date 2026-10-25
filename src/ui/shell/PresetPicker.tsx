import { Car, Container, Droplets, Layers, Mountain, Search, Snowflake, Truck, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PRESET_CATEGORIES, VEHICLE_PRESETS, type PresetCategory, type VehiclePresetInfo } from '../../domain/presets';
import type { Region } from '../../domain/types';
import { inputClass } from '../common/fields';

const REGIONS: { region: Region; label: string }[] = [
  { region: 'ID', label: 'Indonesia' },
  { region: 'EU', label: 'Europe' },
  { region: 'US', label: 'North America' },
  { region: 'INTL', label: 'International' },
];
const REGION_LABEL = new Map<Region, string>(REGIONS.map((r) => [r.region, r.label]));
const CATEGORY_LABEL = new Map(PRESET_CATEGORIES.map((c) => [c.id, c.label]));
const CATEGORY_ICON: Record<PresetCategory, LucideIcon> = {
  truck: Truck,
  van: Car,
  reefer: Snowflake,
  semi: Truck,
  flatbed: Layers,
  container: Container,
  tanker: Droplets,
  tipper: Mountain,
};

/** Lower-cased text every filter word is matched against: name, summary, keywords, category and region labels. */
const searchText = (p: VehiclePresetInfo): string =>
  [p.name, p.summary, ...p.keywords, CATEGORY_LABEL.get(p.category) ?? '', REGION_LABEL.get(p.region) ?? '', p.region].join(' ').toLowerCase();

/** Presets matching every typed word (and the region chip), grouped by category in PRESET_CATEGORIES order. */
function groupedPresets(query: string, region: Region | 'all'): { label: string; presets: VehiclePresetInfo[] }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = VEHICLE_PRESETS.filter((p) => (region === 'all' || p.region === region) && (words.length === 0 || words.every((w) => searchText(p).includes(w))));
  return PRESET_CATEGORIES.map((c) => ({ label: c.label, presets: matches.filter((p) => p.category === c.id) })).filter((g) => g.presets.length > 0);
}

/**
 * Searchable vehicle preset list grouped by vehicle type (box trucks, vans, reefers, semis, containers,
 * tankers, dump trucks, flatbeds), each entry with name, summary and a region badge. Words are AND-matched
 * against names, summaries and English / Indonesian keywords ("tangki air", "kontainer 20"). Arrow keys move
 * between the filter box and the entries.
 */
export function PresetList({ onPick, currentId, footer, autoFocus = true }: { onPick: (presetId: string) => void; currentId?: string; footer?: ReactNode; autoFocus?: boolean }) {
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<Region | 'all'>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = groupedPresets(query, region);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const onKey = (e: KeyboardEvent) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-preset]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') (i <= 0 ? inputRef.current : items[i - 1])?.focus();
    else if (e.key === 'Enter' && document.activeElement === inputRef.current && items[0]) items[0].click();
    else return;
    e.preventDefault();
  };

  return (
    <div onKeyDown={onKey} className="flex min-h-0 flex-col">
      <div className="relative p-1">
        <Search className="pointer-events-none absolute left-3.5 top-[22px] h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          ref={inputRef}
          aria-label="Filter vehicle presets"
          placeholder="Search: tangki air, dump, kontainer 20, reefer…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputClass} !h-8 pl-8 text-xs`}
        />
        <div role="radiogroup" aria-label="Region" className="mt-1.5 flex flex-wrap gap-1">
          {[{ region: 'all' as const, label: 'All' }, ...REGIONS].map((r) => (
            <button
              key={r.region}
              type="button"
              role="radio"
              aria-checked={region === r.region}
              onClick={() => setRegion(r.region)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                region === r.region ? 'border-ink bg-ink text-white' : 'border-line text-ink-soft hover:bg-black/5'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1">
        {groups.length === 0 && <p className="px-2.5 py-3 text-xs text-muted">No vehicle matches “{query}”{region !== 'all' ? ` in ${REGION_LABEL.get(region)}` : ''}.</p>}
        {groups.map((g) => (
          <div key={g.label} role="group" aria-label={g.label} className="mb-1">
            <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{g.label}</div>
            {g.presets.map((p) => {
              const Icon = CATEGORY_ICON[p.category];
              return (
                <button
                  key={p.id}
                  type="button"
                  data-preset
                  onClick={() => onPick(p.id)}
                  aria-current={p.id === currentId || undefined}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-black/5 focus:bg-black/5 aria-[current]:bg-accent-soft"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{p.name}</span>
                    <span className="num block truncate text-[11px] text-muted">{p.summary}</span>
                  </span>
                  <span className="mt-0.5 shrink-0 rounded bg-black/[0.06] px-1 py-px text-[9.5px] font-semibold text-ink-soft" title={REGION_LABEL.get(p.region) ?? p.region}>
                    {p.region}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {footer && <div className="border-t border-line p-1">{footer}</div>}
    </div>
  );
}

/** Fixed position below the anchor, or above it when there is not enough room below. */
function popoverStyle(anchor: DOMRect): { left: number; top?: number; bottom?: number; maxHeight: number } {
  const below = window.innerHeight - anchor.bottom - 16;
  const left = Math.min(anchor.left, window.innerWidth - 328);
  return below >= 360 || below >= anchor.top ? { left, top: anchor.bottom + 4, maxHeight: below } : { left, bottom: window.innerHeight - anchor.top + 4, maxHeight: anchor.top - 16 };
}

/** Button that opens a grouped, filterable preset popover (portalled and fixed-positioned so scrolling sidebars don't clip it). */
export function PresetPopover({ trigger, label, onPick, footer, triggerClassName = '' }: { trigger: ReactNode; label: string; onPick: (presetId: string) => void; footer?: (close: () => void) => ReactNode; triggerClassName?: string }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = anchor !== null;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !buttonRef.current?.contains(t)) setAnchor(null);
    };
    const onLayout = () => setAnchor(null);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onLayout);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onLayout);
    };
  }, [open]);
  const close = () => {
    setAnchor(null);
    buttonRef.current?.focus();
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setAnchor(open ? null : (buttonRef.current?.getBoundingClientRect() ?? null))}
        className={`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${triggerClassName}`}
      >
        {trigger}
      </button>
      {anchor &&
        createPortal(
          <div
            ref={popRef}
            id={id}
            role="dialog"
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                close();
              }
            }}
            style={popoverStyle(anchor)}
            className="fixed z-50 flex w-80 flex-col rounded-xl border border-line bg-card shadow-lg print:hidden"
          >
            <PresetList
              onPick={(presetId) => {
                close();
                onPick(presetId);
              }}
              footer={footer?.(close)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
