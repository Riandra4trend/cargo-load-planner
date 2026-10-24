import { create } from 'zustand';

/** How cargo is drawn: realistic goods models or flat coloured blocks (analysis mode). */
export type CargoLook = 'realistic' | 'blocks';

/** Viewport-local UI state (survives switching to the Plan view and back). */
export const useSceneUi = create<{ look: CargoLook; setLook: (look: CargoLook) => void }>()((set) => ({
  look: 'realistic',
  setLook: (look) => set({ look }),
}));
