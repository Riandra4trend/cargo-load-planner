import { create } from 'zustand';
import type { Id } from '../domain/types';

/** How cargo is drawn: realistic goods models or flat coloured blocks (analysis mode). */
export type CargoLook = 'realistic' | 'blocks';

interface SceneUi {
  look: CargoLook;
  setLook: (look: CargoLook) => void;
  /**
   * Units added without a drop position (palette Add, urgent order, Save & place) that the forklift
   * still has to carry from the staging lanes into the truck, in order. Visual only: the plan already
   * holds their final placements.
   */
  deliveries: Id[];
  enqueueDeliveries: (unitIds: Id[]) => void;
  finishDelivery: (unitId: Id) => void;
  clearDeliveries: () => void;
}

/** Viewport-local UI state (survives switching to the Plan view and back). */
export const useSceneUi = create<SceneUi>()((set) => ({
  look: 'realistic',
  setLook: (look) => set({ look }),
  deliveries: [],
  enqueueDeliveries: (unitIds) => set((s) => ({ deliveries: [...s.deliveries, ...unitIds.filter((id) => !s.deliveries.includes(id))] })),
  finishDelivery: (unitId) => set((s) => ({ deliveries: s.deliveries.filter((id) => id !== unitId) })),
  clearDeliveries: () => set((s) => (s.deliveries.length ? { deliveries: [] } : s)),
}));
