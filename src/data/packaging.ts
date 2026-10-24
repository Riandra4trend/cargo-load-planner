import type { Dims, PackagingKind, Shape } from '../domain/types';

export interface PackagingPreset {
  label: string;
  /** Typical outer dimensions of one loaded unit, metres (pallets: footprint + pallet + 1.2 m of goods). */
  dims?: Dims;
  /** Pallet deck height in metres (0 = not palletized); included in dims.h. */
  palletHeight: number;
  /** Packaging / pallet tare, kg (included in the unit's gross weight). */
  tareKg: number;
  shape: Shape;
  note?: string;
  /** Liquid containers: brim (overflow) capacity, litres; the max-fill check uses this. */
  capacityL?: number;
  /** Liquid containers: the nominal fill the container is sold by (default volume in the editor), litres. */
  nominalL?: number;
}

const IN = 0.0254;

/** Packaging presets used by the item editor to prefill size, pallet height, shape and packaging weight. Approximate typical values. */
export const PACKAGING_PRESETS: Record<PackagingKind, PackagingPreset> = {
  'eur-pallet': {
    label: 'EUR pallet 1200 × 800',
    dims: { l: 1.2, w: 0.8, h: 1.344 },
    palletHeight: 0.144,
    tareKg: 25,
    shape: 'box',
    note: 'EPAL 1 · 144 mm deck · ≈ 25 kg',
  },
  'eur-half': {
    label: 'EUR half pallet 800 × 600',
    dims: { l: 0.8, w: 0.6, h: 1.144 },
    palletHeight: 0.144,
    tareKg: 10,
    shape: 'box',
    note: 'EPAL 6 display pallet · ≈ 10 kg',
  },
  'industrial-pallet': {
    label: 'Industrial pallet 1200 × 1000',
    dims: { l: 1.2, w: 1.0, h: 1.344 },
    palletHeight: 0.144,
    tareKg: 33,
    shape: 'box',
    note: 'EPAL 2 / ISO 1200 × 1000 · ≈ 33 kg',
  },
  'us-pallet': {
    label: 'US GMA pallet 48 × 40 in',
    dims: { l: 48 * IN, w: 40 * IN, h: 1.36 },
    palletHeight: 0.14,
    tareKg: 22,
    shape: 'box',
    note: 'GMA 48 × 40 in · 5.5 in deck · ≈ 48 lb',
  },
  carton: {
    label: 'Carton',
    dims: { l: 0.6, w: 0.4, h: 0.4 },
    palletHeight: 0,
    tareKg: 1,
    shape: 'box',
    note: 'Single corrugated carton, floor loaded',
  },
  crate: {
    label: 'Wooden crate',
    dims: { l: 1.2, w: 1.0, h: 1.0 },
    palletHeight: 0,
    tareKg: 40,
    shape: 'box',
    note: 'Skid-based export crate',
  },
  drum: {
    label: '200 L drum',
    dims: { l: 0.585, w: 0.585, h: 0.88 },
    palletHeight: 0,
    tareKg: 18,
    shape: 'cylinder-upright',
    note: 'Steel drum Ø 585 × 880 mm · ≈ 18 kg',
    capacityL: 216,
    nominalL: 200,
  },
  ibc: {
    label: 'IBC tote 1000 L',
    dims: { l: 1.2, w: 1.0, h: 1.15 },
    palletHeight: 0,
    tareKg: 60,
    shape: 'box',
    note: '1200 × 1000 × 1150 mm, integrated pallet base · ≈ 60 kg',
    capacityL: 1050,
    nominalL: 1000,
  },
  jerrycan: {
    label: 'Jerrycan 20 L',
    dims: { l: 0.345, w: 0.165, h: 0.47 },
    palletHeight: 0,
    tareKg: 1.2,
    shape: 'box',
    note: 'HDPE 20 L jerrycan · ≈ 1.2 kg',
    capacityL: 23,
    nominalL: 20,
  },
  'bulk-liquid': {
    label: 'Bulk liquid (tanker compartment)',
    palletHeight: 0,
    tareKg: 0,
    shape: 'box',
    note: 'Carried in a tanker compartment; weight = volume × density',
  },
  'long-goods': {
    label: 'Long goods bundle',
    dims: { l: 4.0, w: 0.4, h: 0.3 },
    palletHeight: 0,
    tareKg: 2,
    shape: 'box',
    note: 'Strapped bundle of profiles, pipes or bars',
  },
  custom: {
    label: 'Custom',
    palletHeight: 0,
    tareKg: 0,
    shape: 'box',
  },
};

export const PACKAGING_KINDS = Object.keys(PACKAGING_PRESETS) as PackagingKind[];
