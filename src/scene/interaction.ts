import type { OrbitControls } from 'three-stdlib';

/**
 * Viewport-wide interaction flags shared by the camera rig and the drag controller. Orbit controls
 * are disabled while a unit is pressed/dragged or while the camera animates.
 */
export const interaction: { dragging: boolean; tweening: boolean; controls: OrbitControls | null } = {
  dragging: false,
  tweening: false,
  controls: null,
};

export function syncControls(): void {
  if (interaction.controls) interaction.controls.enabled = !interaction.dragging && !interaction.tweening;
}
