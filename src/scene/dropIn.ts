import type { Id } from '../domain/types';
import { useStore, type StoreState } from '../state/store';
import { useSceneUi } from './sceneUi';

/** Duration of the drop-in animation of newly placed floor units, ms. */
export const DROP_MS = 350;
/** Height newly placed units drop from, metres. */
export const DROP_HEIGHT = 0.8;
/** Duration of the level rise of a newly placed bulk fill, ms. */
export const RISE_MS = 700;

/** Units placed by a fresh forward edit (add / drop / place), with their start time. */
const fresh = new Map<Id, number>();

/**
 * How the next forward edit placed its units: 'drop' = dropped at the cursor (short drop-in),
 * 'none' = dragged in directly (no animation). Unannounced edits (palette Add, urgent order, Save &
 * place, table Place) are delivered by the forklift.
 */
export type PlacementIntent = 'drop' | 'none';
let nextIntent: PlacementIntent | null = null;

/** Announces how the units of the next plan edit get into the truck (call right before the edit). */
export function markNextPlacement(intent: PlacementIntent): void {
  nextIntent = intent;
}

/**
 * Detects units that become placed through a new edit: not an undo / redo jump, not a plan switch,
 * not while a load / unload simulation runs and not when accepting an optimiser preview. Bulk fills
 * rise into their compartment; floor units drop in or queue for a forklift delivery (see nextIntent).
 */
export function trackDropIns(prev: StoreState, next: StoreState, now: number): void {
  if (next.plan === prev.plan) return;
  const intent = nextIntent;
  nextIntent = null;
  if (next.plan.id !== prev.plan.id) return;
  if (next.plan === prev.future[0] || next.plan === prev.past[prev.past.length - 1]) return;
  if (next.ui.animation.mode !== 'idle' || prev.ui.optimise.diff) return;
  const deliveries: Id[] = [];
  for (const id in next.plan.placements) {
    if (prev.plan.placements[id]) continue;
    if (next.plan.placements[id].compartmentId !== undefined || intent === 'drop') fresh.set(id, now);
    else if (intent !== 'none') deliveries.push(id);
  }
  if (deliveries.length) useSceneUi.getState().enqueueDeliveries(deliveries);
}

if (typeof window !== 'undefined') {
  let prev = useStore.getState();
  useStore.subscribe((state) => {
    trackDropIns(prev, state, performance.now());
    prev = state;
  });
}

/** True while any drop-in animation is still running (forgets finished ones). */
export function dropInsActive(now: number): boolean {
  for (const [id, start] of fresh) if (now - start > Math.max(DROP_MS, RISE_MS)) fresh.delete(id);
  return fresh.size > 0;
}

/**
 * Progress (0..1, eased) of a unit's drop-in animation lasting `duration`, or 1 when it is not
 * animating.
 */
export function dropInProgress(unitId: Id, now: number, duration: number): number {
  const start = fresh.get(unitId);
  if (start === undefined) return 1;
  const t = (now - start) / duration;
  if (t >= 1) return 1;
  const k = Math.max(0, t);
  return 1 - (1 - k) ** 3;
}
