import Papa from 'papaparse';
import { CUSTOM_LIQUID_ID } from '../domain/liquids';
import type { Plan } from '../domain/types';
import { downloadBlob, fileSlug } from './planFile';

/**
 * One CSV row per item line, SI units (metres, kg, litres, kg/L). Column names match the CSV importer's
 * auto-mapping. Library liquids are written by id, custom liquids by name (the density column carries them).
 */
export function itemsToCsv(plan: Plan): string {
  const stopById = new Map(plan.stops.map((s) => [s.id, s]));
  const customerById = new Map(plan.customers.map((c) => [c.id, c]));
  const rows = plan.lines.map((l) => {
    const stop = stopById.get(l.stopId);
    const s = l.spec;
    return {
      name: s.name,
      sku: s.sku,
      category: s.category,
      origin: s.origin,
      quantity: l.quantity,
      contents: l.contents ?? '',
      length_m: s.dims.l,
      width_m: s.dims.w,
      height_m: s.dims.h,
      weight_kg: s.weightKg,
      liquid: s.liquid ? (s.liquid.liquidId === CUSTOM_LIQUID_ID ? s.liquid.name : s.liquid.liquidId) : '',
      volume_l: s.liquid?.volumeL ?? '',
      density_kg_per_l: s.liquid?.densityKgPerL ?? '',
      container_capacity_l: s.liquid?.containerCapacityL ?? '',
      shape: s.shape,
      packaging: s.packaging,
      pallet_height_m: s.palletHeight,
      stackable: s.stackable,
      max_load_on_top_kg: s.maxLoadOnTopKg,
      max_stack_layers: s.maxStackLayers,
      fragile: s.fragile,
      keep_upright: s.keepUpright,
      rotation: s.rotation,
      temperature: s.temp,
      food: s.isFood,
      un_number: s.hazmat?.unNumber ?? '',
      hazmat_class: s.hazmat?.hazClass ?? '',
      packing_group: s.hazmat?.packingGroup ?? '',
      cog_offset_x_m: s.cogOffset.x,
      cog_offset_y_m: s.cogOffset.y,
      cog_offset_z_m: s.cogOffset.z,
      stop: stop?.name ?? '',
      stop_sequence: stop?.sequence ?? '',
      customer: stop ? (customerById.get(stop.customerId)?.name ?? '') : '',
      priority: l.priority,
      notes: s.notes ?? '',
    };
  });
  return Papa.unparse(rows);
}

export function downloadItemsCsv(plan: Plan): void {
  downloadBlob(new Blob([itemsToCsv(plan)], { type: 'text/csv;charset=utf-8' }), `${fileSlug(plan.name)}-items.csv`);
}
