import type { Plan } from '../domain/types';
import { useStore } from '../state/store';
import { loadAutosave, loadLibrary, loadSavedPlan, overwriteSavedPlan, saveAutosave, saveLibrary, savePlanAs } from './persistence';
import { readShareHash, SHARE_HASH_PREFIX } from './share';

const AUTOSAVE_DELAY_MS = 400;
let started = false;

/** Drops the hash from the address bar without adding a history entry. */
function clearHash(): void {
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
}

/**
 * App start-up: hydrate from a `#plan=` share link, else from the autosaved plan, restore the
 * user's template library, then keep both persisted (plan autosave debounced). Safe to call twice.
 */
export function bootstrap(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const { replacePlan, setLibrary, toast } = useStore.getState();

  // Persistence failures are reported once until a later write succeeds.
  let failing = false;
  const persist = (write: () => void) => {
    try {
      write();
      failing = false;
    } catch (err) {
      if (!failing) toast(`Autosave failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      failing = true;
    }
  };

  const hash = window.location.hash;
  const isShareLink = hash.startsWith(SHARE_HASH_PREFIX);
  const shared = isShareLink ? readShareHash(hash) : null;
  if (isShareLink) clearHash();
  const previous = loadAutosave();
  if (shared) {
    // Keep unsaved work: the shared plan replaces the working plan.
    if (previous && previous.id !== shared.id) {
      const saved = loadSavedPlan(previous.id);
      if (!saved || JSON.stringify(saved) !== JSON.stringify(previous)) {
        persist(() => (saved ? savePlanAs(previous, `${previous.name} (unsaved changes)`) : overwriteSavedPlan(previous.id, previous)));
        toast(`Your previous plan “${previous.name}” was kept under Plans.`, 'info');
      }
    }
    replacePlan(shared);
    persist(() => saveAutosave(shared));
    toast('Opened shared plan', 'success');
  } else {
    if (isShareLink) toast('The shared link is damaged or incomplete; opened your last plan instead.', 'error');
    if (previous) replacePlan(previous);
  }
  setLibrary(loadLibrary());

  let timer: number | undefined;
  let pending: Plan | null = null;
  const flush = () => {
    window.clearTimeout(timer);
    timer = undefined;
    const plan = pending;
    pending = null;
    if (plan) persist(() => saveAutosave(plan));
  };

  useStore.subscribe((state, prev) => {
    if (state.plan !== prev.plan) {
      pending = state.plan;
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, AUTOSAVE_DELAY_MS);
    }
    if (state.library !== prev.library) persist(() => saveLibrary(state.library));
  });
  // A reload right after an edit must not lose it.
  window.addEventListener('pagehide', flush);
}
