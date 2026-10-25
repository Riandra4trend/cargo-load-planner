import type { Id } from '../../domain/types';

/** HTML5 drag of an unplaced unit from the item table; the data is the unit id. */
export const CARGO_UNIT_MIME = 'application/x-cargo-unit';
/** HTML5 drag of a template card from the cargo palette; the data is JSON {@link TemplateDragData}. */
export const CARGO_TEMPLATE_MIME = 'application/x-cargo-template';

export interface TemplateDragData {
  templateId: Id;
  quantity: number;
  stopId: Id;
  /** Materials only: litres per unit chosen in the palette, replacing the template's volume. */
  volumeL?: number;
}

/** True when a drag carries cargo: a unit from the item table or a template from the cargo palette. */
export const isCargoDrag = (dt: DataTransfer | null | undefined): boolean => !!dt && (dt.types.includes(CARGO_UNIT_MIME) || dt.types.includes(CARGO_TEMPLATE_MIME));
