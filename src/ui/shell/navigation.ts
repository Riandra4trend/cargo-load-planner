import { useStore } from '../../state/store';

/** Scrolls the item table (wrapped in #item-table by App) into view. */
export function scrollToItemTable(): void {
  document.getElementById('item-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Returns a callback that starts the load-at-dock animation for the active vehicle (leaving the 2D plan view). */
export function useLoadSimulation(): () => void {
  const setAnimation = useStore((s) => s.setAnimation);
  const setView = useStore((s) => s.setView);
  return () => {
    const { ui, plan } = useStore.getState();
    const vehicleId = plan.vehicles.some((v) => v.id === ui.activeVehicleId) ? ui.activeVehicleId : plan.vehicles[0].id;
    if (ui.view === 'plan') setView('3d');
    setAnimation({ mode: 'load', vehicleId, step: 0, playing: true });
  };
}
