import { materialDef } from '../domain/materials';
import type { ItemSpec, ItemTemplate } from '../domain/types';
import { PACKAGING_PRESETS } from './packaging';
import { makeBulkSpec, makeSpec } from './seed';

const EUR = { l: 1.2, w: 0.8 };
const EUR_HALF = { l: 0.8, w: 0.6 };
const IND = { l: 1.2, w: 1.0 };
const US = { l: 1.219, w: 1.016 };
const EUR_DECK = 0.144;
const US_DECK = 0.14;

const tpl = (id: string, spec: ItemSpec, contents?: string): ItemTemplate => ({ id: `tpl-${id}`, spec, contents, builtIn: true });

/** A library liquid in a preset container at its nominal fill: weight = litres × density + container tare. */
function packagedLiquid(materialId: string, kind: 'drum' | 'ibc' | 'jerrycan', partial: Partial<ItemSpec> & Pick<ItemSpec, 'name'>): ItemSpec {
  const def = materialDef(materialId)!;
  const p = PACKAGING_PRESETS[kind];
  const volumeL = p.nominalL!;
  const liquidKg = volumeL * def.densityKgPerL;
  return makeSpec({
    category: 'Liquids',
    packaging: kind,
    shape: p.shape,
    dims: { ...p.dims! },
    weightKg: liquidKg + p.tareKg,
    temp: def.temp,
    isFood: def.isFood,
    hazmat: def.hazmat ? { ...def.hazmat, netQtyKg: Math.round(liquidKg) } : undefined,
    material: { materialId, name: def.name, state: 'liquid', densityKgPerL: def.densityKgPerL, volumeL },
    ...partial,
  });
}

/** 30 × 19 L water bottles (≈ 0.75 kg empty each) in 3 layers on a EUR pallet. */
const BOTTLES = 30;
const BOTTLE_L = 19;
const bottledWater = (): ItemSpec => {
  const def = materialDef('drinking-water')!;
  const volumeL = BOTTLES * BOTTLE_L;
  return makeSpec({
    name: 'Drinking water 19 L bottles',
    sku: 'WTR-0019',
    category: 'Liquids',
    origin: 'Indonesia',
    packaging: 'eur-pallet',
    palletHeight: EUR_DECK,
    dims: { ...EUR, h: 1.62 },
    weightKg: volumeL * def.densityKgPerL + BOTTLES * 0.75 + PACKAGING_PRESETS['eur-pallet'].tareKg,
    isFood: true,
    material: { materialId: def.id, name: def.name, state: 'liquid', densityKgPerL: def.densityKgPerL, volumeL },
  });
};

/**
 * Built-in item templates: typical, approximate figures for common freight. Users copy them into
 * lines through the item editor or the urgent-order dialog and may save their own (store.library).
 */
export const BUILT_IN_TEMPLATES: ItemTemplate[] = [
  tpl(
    'apparel-eur',
    makeSpec({ name: 'Apparel cartons', sku: 'APP-2118', category: 'Apparel', origin: 'Bangladesh', packaging: 'eur-pallet', palletHeight: EUR_DECK, dims: { ...EUR, h: 1.6 }, weightKg: 320, stackable: true, maxLoadOnTopKg: 350, maxStackLayers: 2 }),
    '480 pcs',
  ),
  tpl(
    'footwear-us',
    makeSpec({ name: 'Footwear cartons', sku: 'APP-2131', category: 'Footwear', origin: 'Vietnam', packaging: 'us-pallet', palletHeight: US_DECK, dims: { ...US, h: 1.5 }, weightKg: 420, stackable: true, maxLoadOnTopKg: 300, maxStackLayers: 2 }),
    '220 pairs',
  ),
  tpl(
    'furniture',
    makeSpec({ name: 'Flat-pack furniture cartons', sku: 'FUR-5104', category: 'Furniture', origin: 'Poland', packaging: 'carton', dims: { l: 2.1, w: 0.9, h: 0.5 }, weightKg: 85, stackable: true, maxLoadOnTopKg: 250, maxStackLayers: 3 }),
    '1 wardrobe kit',
  ),
  tpl(
    'tv',
    makeSpec({ name: 'Flat-screen TVs 65"', sku: 'ELC-4620', category: 'Electronics', origin: 'Mexico', packaging: 'eur-pallet', palletHeight: EUR_DECK, dims: { ...EUR, h: 1.9 }, weightKg: 300, fragile: true, rotation: 'none' }),
    '12 sets',
  ),
  tpl(
    'dairy',
    makeSpec({ name: 'Chilled dairy', sku: 'FRS-1102', category: 'Dairy', origin: 'Denmark', packaging: 'eur-pallet', palletHeight: EUR_DECK, dims: { ...EUR, h: 1.5 }, weightKg: 900, temp: 'chilled', isFood: true }),
    '96 crates',
  ),
  tpl(
    'produce',
    makeSpec({ name: 'Fresh produce', sku: 'FRS-1140', category: 'Produce', origin: 'Spain', packaging: 'us-pallet', palletHeight: US_DECK, dims: { ...US, h: 1.6 }, weightKg: 750, temp: 'chilled', isFood: true }),
    '80 cases',
  ),
  tpl(
    'beverages-half',
    makeSpec({ name: 'Beverages, half pallet', sku: 'BEV-0750', category: 'Beverages', origin: 'Belgium', packaging: 'eur-half', palletHeight: EUR_DECK, dims: { ...EUR_HALF, h: 1.35 }, weightKg: 420, stackable: true, maxLoadOnTopKg: 450, maxStackLayers: 2, isFood: true }),
    '60 cases × 6 bottles',
  ),
  tpl(
    'fish',
    makeSpec({ name: 'Frozen fish', sku: 'FRZ-1201', category: 'Seafood', origin: 'Norway', packaging: 'eur-pallet', palletHeight: EUR_DECK, dims: { ...EUR, h: 1.5 }, weightKg: 950, temp: 'frozen', isFood: true }),
    '40 × 20 kg blocks',
  ),
  tpl(
    'pizza',
    makeSpec({ name: 'Frozen pizza', sku: 'FRZ-1230', category: 'Frozen food', origin: 'Italy', packaging: 'eur-pallet', palletHeight: EUR_DECK, dims: { ...EUR, h: 1.8 }, weightKg: 520, temp: 'frozen', isFood: true }),
    '120 cases',
  ),
  tpl(
    'pharma',
    makeSpec({ name: 'Pharmaceuticals (2–8 °C)', sku: 'PHA-7712', category: 'Pharmaceuticals', origin: 'Switzerland', packaging: 'eur-pallet', palletHeight: EUR_DECK, dims: { ...EUR, h: 1.4 }, weightKg: 380, temp: 'chilled', rotation: 'none', notes: 'GDP: keep within the chilled range, do not double-stack.' }),
    '36 insulated shippers',
  ),
  tpl(
    'press-die',
    makeSpec({ name: 'Steel press-die crate', sku: 'IND-3305', category: 'Machinery', origin: 'Germany', packaging: 'crate', dims: { l: 1.2, w: 1.0, h: 0.9 }, weightKg: 1200 }),
  ),
  tpl(
    'machine-skid',
    makeSpec({
      name: 'Machine on skid (offset COG)',
      sku: 'IND-3340',
      category: 'Machinery',
      origin: 'Japan',
      packaging: 'custom',
      dims: { l: 1.6, w: 1.1, h: 1.4 },
      weightKg: 1250,
      cogOffset: { x: 0.35, y: 0, z: -0.2 },
      rotation: 'yaw',
      notes: 'Motor end heavy: COG 0.35 m toward the motor end and 0.2 m below centre.',
    }),
  ),
  tpl(
    'gearbox',
    makeSpec({ name: 'Gearbox housing, crated', sku: 'IND-3317', category: 'Machinery', origin: 'Italy', packaging: 'crate', dims: { l: 1.2, w: 1.0, h: 1.0 }, weightKg: 1150, cogOffset: { x: -0.1, y: 0, z: -0.1 } }),
  ),
  tpl(
    'batteries',
    makeSpec({ name: 'Lithium-ion batteries', sku: 'ELC-4688', category: 'Batteries', origin: 'China', packaging: 'eur-pallet', palletHeight: EUR_DECK, dims: { ...EUR, h: 1.1 }, weightKg: 700, hazmat: { unNumber: 'UN3480', hazClass: '9', packingGroup: 'II', netQtyKg: 560 } }),
    '64 packs',
  ),
  tpl(
    'aerosols',
    makeSpec({ name: 'Aerosol cans', sku: 'CHM-1950', category: 'Chemicals', origin: 'France', packaging: 'eur-pallet', palletHeight: EUR_DECK, dims: { ...EUR, h: 1.2 }, weightKg: 420, hazmat: { unNumber: 'UN1950', hazClass: '2.1', netQtyKg: 300 } }),
    '160 cartons × 12',
  ),
  tpl(
    'paint',
    makeSpec({ name: 'Industrial paint', sku: 'CHM-1263', category: 'Chemicals', origin: 'Netherlands', packaging: 'eur-pallet', palletHeight: EUR_DECK, dims: { ...EUR, h: 1.0 }, weightKg: 620, hazmat: { unNumber: 'UN1263', hazClass: '3', packingGroup: 'II', netQtyKg: 540 } }),
    '48 pails',
  ),
  tpl(
    'cleaner',
    makeSpec({ name: 'Corrosive cleaner', sku: 'CHM-1760', category: 'Chemicals', origin: 'Germany', packaging: 'eur-pallet', palletHeight: EUR_DECK, dims: { ...EUR, h: 1.1 }, weightKg: 680, hazmat: { unNumber: 'UN1760', hazClass: '8', packingGroup: 'II', netQtyKg: 600 } }),
    '60 jerricans × 10 L',
  ),
  tpl(
    'pesticide',
    makeSpec({ name: 'Pesticide', sku: 'AGR-2588', category: 'Agrochemicals', origin: 'India', packaging: 'eur-pallet', palletHeight: EUR_DECK, dims: { ...EUR, h: 1.0 }, weightKg: 500, hazmat: { unNumber: 'UN2588', hazClass: '6.1', packingGroup: 'III', netQtyKg: 450 } }),
    '40 bags × 12 kg',
  ),
  tpl(
    'glass',
    makeSpec({ name: 'Glass panels, A-frame crate', sku: 'GLS-4702', category: 'Glass', origin: 'Germany', packaging: 'crate', dims: { l: 2.4, w: 0.6, h: 1.8 }, weightKg: 520, fragile: true, keepUpright: true, rotation: 'yaw', notes: 'Fragile: transport upright, nothing on top.' }),
  ),
  tpl(
    'steel-profiles',
    makeSpec({ name: 'Steel profiles 4 m', sku: 'IND-3362', category: 'Steel', origin: 'Poland', packaging: 'long-goods', dims: { l: 4.0, w: 0.4, h: 0.3 }, weightKg: 420, stackable: true, maxLoadOnTopKg: 400, maxStackLayers: 3, keepUpright: false, rotation: 'yaw' }),
    '12 × IPE 120',
  ),
  tpl(
    'paper-roll',
    makeSpec({ name: 'Paper roll', sku: 'PAP-8810', category: 'Paper', origin: 'Finland', packaging: 'custom', shape: 'cylinder-lying', dims: { l: 1.4, w: 1.25, h: 1.25 }, weightKg: 1150, rotation: 'yaw', notes: 'Lying reel: chock both sides against rolling.' }),
  ),
  tpl(
    'cable-reel',
    makeSpec({ name: 'Cable reel', sku: 'ELC-5520', category: 'Cable', origin: 'Sweden', packaging: 'custom', shape: 'cylinder-lying', dims: { l: 0.9, w: 1.4, h: 1.4 }, weightKg: 850, rotation: 'yaw' }),
    '500 m NYY 4 × 95',
  ),
  tpl(
    'bricks',
    makeSpec({ name: 'Bricks on industrial pallet', sku: 'BLD-0410', category: 'Building materials', origin: 'Czechia', packaging: 'industrial-pallet', palletHeight: EUR_DECK, dims: { ...IND, h: 1.0 }, weightKg: 1300 }),
    '400 bricks',
  ),

  // Liquids: packaged ------------------------------------------------------------------------------
  tpl('diesel-drum', packagedLiquid('diesel', 'drum', { name: 'Diesel drum 200 L', sku: 'FUE-1202', origin: 'Singapore', stackable: true, maxLoadOnTopKg: 400, maxStackLayers: 2 }), '200 L'),
  tpl('oil-drum', packagedLiquid('lube-oil', 'drum', { name: 'Lubricating oil drum 200 L', sku: 'LUB-0200', origin: 'Belgium', stackable: true, maxLoadOnTopKg: 400, maxStackLayers: 2 }), '200 L'),
  tpl('water-ibc', packagedLiquid('drinking-water', 'ibc', { name: 'Drinking water IBC 1,000 L', sku: 'WTR-1000', origin: 'Indonesia', stackable: true, maxLoadOnTopKg: 1100, maxStackLayers: 2 }), '1,000 L'),
  tpl('palm-oil-ibc', packagedLiquid('palm-oil', 'ibc', { name: 'Palm oil IBC 1,000 L', sku: 'FOD-0910', origin: 'Malaysia', stackable: true, maxLoadOnTopKg: 1000, maxStackLayers: 2 }), '1,000 L'),
  tpl('sulfuric-ibc', packagedLiquid('sulfuric-acid', 'ibc', { name: 'Sulfuric acid IBC 1,000 L', sku: 'CHM-1830', origin: 'Germany' }), '1,000 L'),
  tpl('gasoline-jerrycan', packagedLiquid('gasoline', 'jerrycan', { name: 'Gasoline jerrycan 20 L', sku: 'FUE-1203', origin: 'Indonesia', stackable: true, maxLoadOnTopKg: 60, maxStackLayers: 3 }), '20 L'),
  tpl('water-bottles', bottledWater(), `${BOTTLES} × ${BOTTLE_L} L bottles`),

  // Liquids: bulk tanker fills (largest legal fill of the preset compartments at the liquid's max fill) --
  tpl('diesel-bulk', makeBulkSpec('diesel', 7700, { name: 'Diesel, bulk 7,700 L', sku: 'BLK-1202', category: 'Liquids' }), '7,700 L'),
  tpl('gasoline-bulk', makeBulkSpec('gasoline', 5800, { name: 'Gasoline, bulk 5,800 L', sku: 'BLK-1203', category: 'Liquids' }), '5,800 L'),
  tpl('water-bulk', makeBulkSpec('water', 7800, { name: 'Water, bulk 7,800 L', sku: 'BLK-0001', category: 'Liquids' }), '7,800 L'),
  tpl('milk-bulk', makeBulkSpec('milk', 7800, { name: 'Milk, bulk 7,800 L (chilled)', sku: 'BLK-0103', category: 'Liquids' }), '7,800 L'),
  tpl('palm-oil-bulk', makeBulkSpec('palm-oil', 7700, { name: 'Palm oil, bulk 7,700 L', sku: 'BLK-0910', category: 'Liquids' }), '7,700 L'),

  // Dry bulk: dump-truck loads, each legal on an empty tronton dump truck (6×4, 15 t payload) -------
  tpl('sand-wet-bulk', makeBulkSpec('sand-wet', 7800, { name: 'Sand (wet), 7.8 m³ tronton load', sku: 'AGG-1900', category: 'Dry bulk' }), '7.8 m³'),
  tpl('sand-dry-bulk', makeBulkSpec('sand-dry', 9000, { name: 'Sand (dry), 9 m³', sku: 'AGG-1600', category: 'Dry bulk' }), '9 m³'),
  tpl('gravel-bulk', makeBulkSpec('gravel', 9000, { name: 'Gravel / split, 9 m³', sku: 'AGG-1550', category: 'Dry bulk' }), '9 m³'),
  tpl('soil-bulk', makeBulkSpec('soil', 11000, { name: 'Soil (loose), 11 m³', sku: 'AGG-1300', category: 'Dry bulk' }), '11 m³'),
  tpl('coal-bulk', makeBulkSpec('coal', 16000, { name: 'Coal, 16 m³', sku: 'MIN-0850', category: 'Dry bulk' }), '16 m³'),
  tpl('nickel-ore-bulk', makeBulkSpec('nickel-ore', 9000, { name: 'Nickel ore, 9 m³', sku: 'MIN-1600', category: 'Dry bulk' }), '9 m³'),
  tpl('palm-ffb-bulk', makeBulkSpec('palm-ffb', 16000, { name: 'Palm fruit bunches (TBS), 16 m³', sku: 'AGR-0500', category: 'Dry bulk' }), '16 m³'),
  tpl('paddy-bulk', makeBulkSpec('paddy', 16000, { name: 'Paddy (gabah), 16 m³', sku: 'AGR-0580', category: 'Dry bulk' }), '16 m³'),
];
