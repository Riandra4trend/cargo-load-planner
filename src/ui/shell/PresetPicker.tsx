import { Search, Truck } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { VEHICLE_PRESETS, type VehiclePresetInfo } from '../../domain/presets';
import type { Region } from '../../domain/types';
import { inputClass } from '../common/fields';

const REGION_ORDER: { region: Region; label: string }[] = [
  { region: 'ID', label: 'Indonesia' },
  { region: 'EU', label: 'Europe' },
  { region: 'US', label: 'North America' },
  { region: 'INTL', label: 'ISO containers' },
];

/** Presets grouped by region in a fixed order (unknown regions last). */
function groupedPresets(query: string): { label: string; presets: VehiclePresetInfo[] }[] {
  const q = query.trim().toLowerCase();
  const match = (p: VehiclePresetInfo) => !q || `${p.name} ${p.summary} ${p.region}`.toLowerCase().includes(q);
  const known = new Set(REGION_ORDER.map((r) => r.region));
  const groups = REGION_ORDER.map(({ region, label }) => ({ label, presets: VEHICLE_PRESETS.filter((p) => p.region === region && match(p)) }));
  groups.push({ label: 'Other', presets: VEHICLE_PRESETS.filter((p) => !known.has(p.region) && match(p)) });
  return groups.filter((g) => g.presets.length > 0);
}

/**
 * Searchable vehicle preset list grouped by region (Indonesia, Europe, North America, ISO containers),
 * each entry with its name and summary. Arrow keys move between the filter box and the entries.
 */
export function PresetList({ onPick, currentId, footer, autoFocus = true }: { onPick: (presetId: string) => void; currentId?: string; footer?: ReactNode; autoFocus?: boolean }) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = groupedPresets(query);
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
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
        <input ref={inputRef} aria-label="Filter vehicle presets" placeholder="Filter: tronton, dump, 40 ft, reefer…" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} !h-8 pl-8 text-xs`} />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1">
        {groups.length === 0 && <p className="px-2.5 py-3 text-xs text-muted">No preset matches “{query}”.</p>}
        {groups.map((g) => (
          <div key={g.label} role="group" aria-label={g.label} className="mb-1">
            <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{g.label}</div>
            {g.presets.map((p) => (
              <button
                key={p.id}
                type="button"
                data-preset
                onClick={() => onPick(p.id)}
                aria-current={p.id === currentId || undefined}
                className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-black/5 focus:bg-black/5 aria-[current]:bg-accent-soft"
              >
                <Truck className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{p.name}</span>
                  <span className="num block truncate text-[11px] text-muted">{p.summary}</span>
                </span>
              </button>
            ))}
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
