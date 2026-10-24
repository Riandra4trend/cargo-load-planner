import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
  /** Tailwind max-width class, e.g. "max-w-lg" (default) or "max-w-4xl". */
  width?: string;
}

/** Open modals, oldest first: Esc closes only the topmost one when dialogs stack. */
const openModals: symbol[] = [];

/** Centered dialog rendered in a portal; closes on Esc (topmost dialog only) and backdrop click. */
export function Modal({ open, title, onClose, children, footer, icon, width = 'max-w-lg' }: ModalProps) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const token = Symbol('modal');
    openModals.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === token) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      openModals.splice(openModals.indexOf(token), 1);
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[1px] print:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" className={`flex max-h-[92vh] w-full ${width} flex-col rounded-2xl border border-line bg-card shadow-2xl`}>
        <header className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          {icon && <span className="text-accent-strong [&>svg]:h-5 [&>svg]:w-5">{icon}</span>}
          <h2 className="flex-1 text-base font-semibold">{title}</h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-canvas/60 px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
