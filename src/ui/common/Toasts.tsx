import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { useStore } from '../../state/store';

const ICONS = { info: Info, success: CheckCircle2, error: TriangleAlert };
const TONES = { info: 'text-info', success: 'text-ok', error: 'text-bad' };

export function Toasts() {
  const toasts = useStore((s) => s.ui.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2 print:hidden">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-card px-3.5 py-3 text-sm shadow-lg">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONES[t.kind]}`} />
            <p className="flex-1 text-ink">{t.text}</p>
            <button type="button" aria-label="Dismiss" className="text-muted hover:text-ink" onClick={() => dismiss(t.id)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
