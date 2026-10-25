import type { Hazmat, ItemSpec, MaterialContents, MaterialState, TempClass } from './types';

export type MaterialCategory = 'water' | 'fuel' | 'oil' | 'food' | 'chemical' | 'gas' | 'aggregate' | 'mineral' | 'agri' | 'biomass';

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  water: 'Water',
  fuel: 'Fuels',
  oil: 'Oils',
  food: 'Food liquids',
  chemical: 'Chemicals',
  gas: 'Liquefied gas',
  aggregate: 'Sand, gravel & earth',
  mineral: 'Coal, ores & minerals',
  agri: 'Grain & agricultural',
  biomass: 'Biomass',
};

/**
 * Reference material measured by volume: liquids (tankers, drums, IBCs) and dry bulk (tipper bodies).
 * Densities are typical values (liquids at 15 °C, solids as loose bulk density in the body); real
 * products vary (diesel 0.82-0.86 kg/L, wet sand up to 2 t/m³), so the editor lets users override the
 * density per item. Hazmat data is the usual road-transport entry and is illustrative, not a
 * classification service.
 */
export interface MaterialDef {
  id: string;
  name: string;
  state: MaterialState;
  /** kg per litre, which equals t/m³. */
  densityKgPerL: number;
  category: MaterialCategory;
  /** Colour of the material in the 3D view and legends. */
  color: string;
  temp: TempClass;
  isFood: boolean;
  hazmat?: Hazmat;
  /**
   * Highest fill, % of capacity: liquids leave room for thermal expansion (of a tank compartment's or
   * container's brim capacity); dry bulk fills a tipper body level with its sides (100 % of struck capacity).
   */
  maxFillPct: number;
  /** Liquefied gas: travels in bulk only in a pressurised tank. */
  pressurised?: true;
  note?: string;
}

const solid = (id: string, name: string, densityKgPerL: number, category: MaterialCategory, color: string, extra: Partial<MaterialDef> = {}): MaterialDef => ({
  id,
  name,
  state: 'solid',
  densityKgPerL,
  category,
  color,
  temp: 'ambient',
  isFood: false,
  maxFillPct: 100,
  ...extra,
});

export const MATERIAL_LIBRARY: MaterialDef[] = [
  { id: 'water', name: 'Water', state: 'liquid', densityKgPerL: 1.0, category: 'water', color: '#4DA3FF', temp: 'ambient', isFood: false, maxFillPct: 98 },
  { id: 'drinking-water', name: 'Drinking water', state: 'liquid', densityKgPerL: 1.0, category: 'water', color: '#7CC4FF', temp: 'ambient', isFood: true, maxFillPct: 98 },
  { id: 'seawater', name: 'Seawater / brine', state: 'liquid', densityKgPerL: 1.025, category: 'water', color: '#2E86AB', temp: 'ambient', isFood: false, maxFillPct: 98 },
  {
    id: 'diesel',
    name: 'Diesel (solar)',
    state: 'liquid',
    densityKgPerL: 0.84,
    category: 'fuel',
    color: '#E9C46A',
    temp: 'ambient',
    isFood: false,
    hazmat: { unNumber: 'UN1202', hazClass: '3', packingGroup: 'III' },
    maxFillPct: 97,
    note: 'Typical 0.82-0.86 kg/L',
  },
  {
    id: 'gasoline',
    name: 'Gasoline (bensin)',
    state: 'liquid',
    densityKgPerL: 0.74,
    category: 'fuel',
    color: '#F4A261',
    temp: 'ambient',
    isFood: false,
    hazmat: { unNumber: 'UN1203', hazClass: '3', packingGroup: 'II' },
    maxFillPct: 97,
    note: 'Typical 0.72-0.77 kg/L',
  },
  { id: 'kerosene', name: 'Kerosene (minyak tanah)', state: 'liquid', densityKgPerL: 0.8, category: 'fuel', color: '#CDB4DB', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1223', hazClass: '3', packingGroup: 'III' }, maxFillPct: 97 },
  { id: 'jet-a1', name: 'Jet fuel (Jet A-1)', state: 'liquid', densityKgPerL: 0.8, category: 'fuel', color: '#B8C0FF', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1863', hazClass: '3', packingGroup: 'III' }, maxFillPct: 97 },
  {
    id: 'crude-oil',
    name: 'Crude oil',
    state: 'liquid',
    densityKgPerL: 0.87,
    category: 'oil',
    color: '#3D3B30',
    temp: 'ambient',
    isFood: false,
    hazmat: { unNumber: 'UN1267', hazClass: '3', packingGroup: 'II' },
    maxFillPct: 97,
    note: 'Varies 0.80-0.95 kg/L; packing group depends on the crude',
  },
  { id: 'lube-oil', name: 'Lubricating / engine oil', state: 'liquid', densityKgPerL: 0.88, category: 'oil', color: '#C08B2C', temp: 'ambient', isFood: false, maxFillPct: 97 },
  { id: 'palm-oil', name: 'Palm oil (CPO)', state: 'liquid', densityKgPerL: 0.91, category: 'food', color: '#E76F51', temp: 'ambient', isFood: true, maxFillPct: 97, note: 'Often carried warm; density drops slightly when heated' },
  { id: 'vegetable-oil', name: 'Vegetable cooking oil', state: 'liquid', densityKgPerL: 0.92, category: 'food', color: '#F2CC8F', temp: 'ambient', isFood: true, maxFillPct: 97 },
  { id: 'milk', name: 'Milk', state: 'liquid', densityKgPerL: 1.03, category: 'food', color: '#F1F3F5', temp: 'chilled', isFood: true, maxFillPct: 98 },
  { id: 'fruit-juice', name: 'Fruit juice', state: 'liquid', densityKgPerL: 1.05, category: 'food', color: '#FFB703', temp: 'chilled', isFood: true, maxFillPct: 98 },
  { id: 'molasses', name: 'Molasses', state: 'liquid', densityKgPerL: 1.4, category: 'food', color: '#6F4518', temp: 'ambient', isFood: true, maxFillPct: 98 },
  { id: 'ethanol', name: 'Ethanol', state: 'liquid', densityKgPerL: 0.79, category: 'chemical', color: '#BDE0FE', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1170', hazClass: '3', packingGroup: 'II' }, maxFillPct: 97 },
  { id: 'methanol', name: 'Methanol', state: 'liquid', densityKgPerL: 0.792, category: 'chemical', color: '#A2D2FF', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1230', hazClass: '3', packingGroup: 'II' }, maxFillPct: 97, note: 'Subsidiary hazard 6.1 (toxic)' },
  { id: 'sulfuric-acid', name: 'Sulfuric acid 98 %', state: 'liquid', densityKgPerL: 1.84, category: 'chemical', color: '#FFD6A5', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1830', hazClass: '8', packingGroup: 'II' }, maxFillPct: 97 },
  { id: 'hydrochloric-acid', name: 'Hydrochloric acid 33 %', state: 'liquid', densityKgPerL: 1.16, category: 'chemical', color: '#FDFFB6', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1789', hazClass: '8', packingGroup: 'II' }, maxFillPct: 97 },
  { id: 'caustic-soda', name: 'Caustic soda solution 50 %', state: 'liquid', densityKgPerL: 1.52, category: 'chemical', color: '#E9ECEF', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1824', hazClass: '8', packingGroup: 'II' }, maxFillPct: 97 },
  { id: 'liquid-fertilizer', name: 'Liquid fertilizer (UAN 32)', state: 'liquid', densityKgPerL: 1.32, category: 'chemical', color: '#99D98C', temp: 'ambient', isFood: false, maxFillPct: 97 },
  { id: 'lpg', name: 'LPG (liquefied, pressurised)', state: 'liquid', densityKgPerL: 0.54, category: 'gas', color: '#90E0EF', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1075', hazClass: '2.1' }, maxFillPct: 85, pressurised: true, note: 'Pressure tank only; propane/butane mix' },

  solid('sand-dry', 'Sand (dry)', 1.6, 'aggregate', '#E3C58D', { note: 'Loose dry sand 1.5-1.7 t/m³' }),
  solid('sand-wet', 'Sand (wet)', 1.9, 'aggregate', '#B8955E', { note: 'Rain or washing adds 15-25 %' }),
  solid('gravel', 'Gravel / crushed stone (split)', 1.55, 'aggregate', '#A3A3A0', { note: 'Typical 1.5-1.7 t/m³' }),
  solid('soil', 'Soil / earth (loose)', 1.3, 'aggregate', '#7A5C3E', { note: 'Excavated earth 1.2-1.5 t/m³; wet clay is heavier' }),
  solid('clay', 'Clay (loose)', 1.7, 'aggregate', '#A86B4B', { note: 'Wet clay up to 2.0 t/m³' }),
  solid('asphalt', 'Asphalt hot mix', 2.0, 'aggregate', '#2F2F2F', { note: 'Delivered at about 150 °C; loose density in the body' }),
  solid('coal', 'Coal (batubara)', 0.85, 'mineral', '#222222', { note: 'Typical 0.80-0.90 t/m³ loose' }),
  solid('nickel-ore', 'Nickel ore (laterite)', 1.6, 'mineral', '#8C4A2F', { note: 'Wet laterite 1.5-1.9 t/m³' }),
  solid('iron-ore', 'Iron ore', 2.4, 'mineral', '#6B3E2E', { note: 'Lump ore 2.2-2.6 t/m³' }),
  solid('limestone', 'Limestone (crushed)', 1.55, 'mineral', '#D9D4C5'),
  solid('salt', 'Salt (coarse)', 1.2, 'mineral', '#F2F0EA'),
  solid('paddy', 'Paddy rice (gabah)', 0.58, 'agri', '#D4B483', { isFood: true, note: 'Unhulled rice' }),
  solid('rice', 'Rice, milled (beras)', 0.8, 'agri', '#EFE6D2', { isFood: true }),
  solid('corn', 'Corn / maize (jagung)', 0.72, 'agri', '#F2C14E', { isFood: true }),
  solid('wheat', 'Wheat', 0.78, 'agri', '#D9B26F', { isFood: true }),
  solid('soybeans', 'Soybeans (kedelai)', 0.75, 'agri', '#C9B37E', { isFood: true }),
  solid('sugar', 'Sugar (granulated)', 0.85, 'agri', '#F7F3EA', { isFood: true }),
  solid('palm-ffb', 'Palm fruit bunches (TBS sawit)', 0.5, 'agri', '#7A2E1F', { note: 'Loose fresh fruit bunches 0.45-0.55 t/m³' }),
  solid('urea', 'Urea fertilizer (granular)', 0.75, 'agri', '#FAFAFA'),
  solid('wood-chips', 'Wood chips', 0.3, 'biomass', '#B08D57', { note: 'Fresh chips 0.25-0.40 t/m³' }),
];

/**
 * The spec with a different volume of its material: weight = the container tare (what the old weight
 * held beyond the old volume × density; 0 for bulk fills) + new volume × density. Specs without a
 * material are returned unchanged.
 */
export function withMaterialVolume(spec: ItemSpec, volumeL: number): ItemSpec {
  const m = spec.material;
  if (!m) return spec;
  const tareKg = Math.max(0, spec.weightKg - m.volumeL * m.densityKgPerL);
  return { ...spec, weightKg: tareKg + volumeL * m.densityKgPerL, material: { ...m, volumeL } };
}

export const CUSTOM_MATERIAL_ID = 'custom';

const BY_ID = new Map(MATERIAL_LIBRARY.map((m) => [m.id, m]));

/** Reference material by id (undefined for custom materials). */
export function materialDef(id: string): MaterialDef | undefined {
  return BY_ID.get(id);
}

/** Net weight of material contents, kg. */
export function materialWeightKg(material: Pick<MaterialContents, 'volumeL' | 'densityKgPerL'>): number {
  return material.volumeL * material.densityKgPerL;
}

/** Highest fill for a material, % of capacity (custom: 97 % for liquids, 100 % for dry bulk). */
export function maxFillPct(materialId: string, state: MaterialState): number {
  return BY_ID.get(materialId)?.maxFillPct ?? (state === 'solid' ? 100 : 97);
}

/** True when the material needs a pressurised tank in bulk (liquefied gases). Custom materials never do. */
export function needsPressureTank(materialId: string): boolean {
  return BY_ID.get(materialId)?.pressurised === true;
}

/** Display colour of a material (a neutral blue-grey for custom liquids, warm grey for custom solids). */
export function materialColor(materialId: string, state: MaterialState = 'liquid'): string {
  return BY_ID.get(materialId)?.color ?? (state === 'solid' ? '#9C8F80' : '#8D99AE');
}
