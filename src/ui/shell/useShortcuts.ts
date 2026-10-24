import { useEffect } from 'react';
import { useStore, type ViewMode } from '../../state/store';

const VIEW_KEYS: Record<string, ViewMode> = { '1': '3d', '2': 'side', '3': 'top', '4': 'plan' };

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}

/**
 * Global keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z redo, 1–4 views,
 * Space play/pause, Delete/Backspace unplace, R rotate, F focus, Esc clear selection. Ignored while
 * typing, while a 3D drag is active (the scene owns R/Esc then) and while a dialog is open.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      const s = useStore.getState();
      const { ui } = s;
      if (ui.drag || Object.keys(ui.dialogs).length > 0 || ui.optimise.running || ui.optimise.diff) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && !e.altKey) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          s.undo();
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          s.redo();
        }
        return;
      }
      if (e.altKey) return;

      if (VIEW_KEYS[e.key]) {
        e.preventDefault();
        s.setView(VIEW_KEYS[e.key]);
        return;
      }
      const placedSelection = ui.selection.filter((id) => s.plan.placements[id]);
      switch (key) {
        case ' ': {
          const target = e.target as HTMLElement | null;
          if (ui.animation.mode === 'idle' || target?.closest('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="radio"], [role="switch"]')) return;
          e.preventDefault();
          s.setAnimation({ playing: !ui.animation.playing });
          return;
        }
        case 'delete':
        case 'backspace':
          if (!placedSelection.length) return;
          e.preventDefault();
          s.unplaceUnits(placedSelection);
          return;
        case 'r':
          if (!placedSelection.length) return;
          e.preventDefault();
          for (const id of placedSelection) s.rotateUnit(id);
          return;
        case 'f':
          if (!ui.selection.length) return;
          e.preventDefault();
          s.requestFocus(ui.selection[0]);
          return;
        case 'escape':
          if (!ui.selection.length) return;
          e.preventDefault();
          s.select([]);
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
