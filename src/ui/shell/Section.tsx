import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

/** Collapsible right-panel section with a header row (title + optional right-aligned content). */
export function Section({ title, icon, right, children, defaultOpen = true }: { title: ReactNode; icon?: ReactNode; right?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {icon && <span className="text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
          <h3 className="flex-1 truncate text-[13px] font-semibold text-ink">{title}</h3>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
        </button>
        {right}
      </div>
      {open && (
        <div id={id} className="px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}
