import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type MenuEntry =
  | { kind?: 'item'; label: string; icon?: ReactNode; hint?: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
  | { kind: 'separator' }
  | { kind: 'heading'; label: string };

/**
 * Accessible menu button: the trigger toggles a `role="menu"` popup; arrow keys move between
 * items, Enter/Space activates, Esc or an outside click closes and returns focus to the trigger.
 */
export function Menu({
  trigger,
  label,
  entries,
  align = 'left',
  triggerClassName = '',
  width = 'w-60',
}: {
  trigger: ReactNode;
  label: string;
  entries: MenuEntry[];
  align?: 'left' | 'right';
  triggerClassName?: string;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Fixed positioning from the trigger's rect, clamped (and flipped upward) to stay inside the
  // window, so menus in narrow or scrolling containers (sidebar, panels) are never clipped.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = buttonRef.current?.getBoundingClientRect();
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const margin = 8;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const preferredLeft = align === 'right' ? trigger.right - w : trigger.left;
    const left = Math.min(Math.max(margin, preferredLeft), window.innerWidth - w - margin);
    const below = trigger.bottom + 4;
    const top = below + h <= window.innerHeight - margin ? below : Math.max(margin, trigger.top - h - 4);
    setPos({ left, top });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Move focus into the menu once it is positioned and visible (hidden elements can't take focus).
  useEffect(() => {
    if (pos) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
  }, [pos]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items[items.length - 1]?.focus();
    else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close(false);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${triggerClassName}`}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          className={`z-50 ${width} max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-lg`}
        >
          {entries.map((entry, i) => {
            if (entry.kind === 'separator') return <div key={i} role="separator" className="my-1 h-px bg-line" />;
            if (entry.kind === 'heading')
              return (
                <div key={i} className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                  {entry.label}
                </div>
              );
            return (
              <div
                key={i}
                role="menuitem"
                tabIndex={-1}
                aria-disabled={entry.disabled || undefined}
                onClick={() => {
                  if (entry.disabled) return;
                  close(false);
                  entry.onSelect();
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !entry.disabled) {
                    e.preventDefault();
                    close();
                    entry.onSelect();
                  }
                }}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:bg-black/5 hover:bg-black/5 aria-disabled:cursor-default aria-disabled:opacity-45 ${
                  entry.danger ? 'text-bad' : 'text-ink'
                }`}
              >
                {entry.icon && <span className="text-muted [&>svg]:h-4 [&>svg]:w-4">{entry.icon}</span>}
                <span className="flex-1 truncate">{entry.label}</span>
                {entry.hint && <span className="text-xs text-muted">{entry.hint}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
