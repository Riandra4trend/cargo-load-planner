import type { Hazmat, LiquidContents, TempClass } from './types';

export type LiquidCategory = 'water' | 'fuel' | 'oil' | 'food' | 'chemical' | 'gas';

/**
 * Reference liquid. Densities are typical values at 15 °C; real products vary (e.g. diesel 0.82-0.86,
 * crude 0.80-0.95), so the editor lets users override the density per item. Hazmat data is the usual
 * road-transport entry for the product and is illustrative, not a classification service.
 */
export interface LiquidDef {
  id: string;
  name: string;
  densityKgPerL: number;
  category: LiquidCategory;
  /** Colour of the liquid in the 3D view and legends. */
  color: string;
  temp: TempClass;
  isFood: boolean;
  hazmat?: Hazmat;
  /** Highest safe fill of a tank compartment or container, % of brim capacity (thermal expansion / ullage). */
  maxFillPct: number;
  note?: string;
}

export const LIQUIDS: LiquidDef[] = [
  { id: 'water', name: 'Water', densityKgPerL: 1.0, category: 'water', color: '#4DA3FF', temp: 'ambient', isFood: false, maxFillPct: 98 },
  { id: 'drinking-water', name: 'Drinking water', densityKgPerL: 1.0, category: 'water', color: '#7CC4FF', temp: 'ambient', isFood: true, maxFillPct: 98 },
  { id: 'seawater', name: 'Seawater / brine', densityKgPerL: 1.025, category: 'water', color: '#2E86AB', temp: 'ambient', isFood: false, maxFillPct: 98 },
  {
    id: 'diesel',
    name: 'Diesel (solar)',
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
    densityKgPerL: 0.74,
    category: 'fuel',
    color: '#F4A261',
    temp: 'ambient',
    isFood: false,
    hazmat: { unNumber: 'UN1203', hazClass: '3', packingGroup: 'II' },
    maxFillPct: 97,
    note: 'Typical 0.72-0.77 kg/L',
  },
  { id: 'kerosene', name: 'Kerosene (minyak tanah)', densityKgPerL: 0.8, category: 'fuel', color: '#CDB4DB', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1223', hazClass: '3', packingGroup: 'III' }, maxFillPct: 97 },
  { id: 'jet-a1', name: 'Jet fuel (Jet A-1)', densityKgPerL: 0.8, category: 'fuel', color: '#B8C0FF', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1863', hazClass: '3', packingGroup: 'III' }, maxFillPct: 97 },
  {
    id: 'crude-oil',
    name: 'Crude oil',
    densityKgPerL: 0.87,
    category: 'oil',
    color: '#3D3B30',
    temp: 'ambient',
    isFood: false,
    hazmat: { unNumber: 'UN1267', hazClass: '3', packingGroup: 'II' },
    maxFillPct: 97,
    note: 'Varies 0.80-0.95 kg/L; packing group depends on the crude',
  },
  { id: 'lube-oil', name: 'Lubricating / engine oil', densityKgPerL: 0.88, category: 'oil', color: '#C08B2C', temp: 'ambient', isFood: false, maxFillPct: 97 },
  { id: 'palm-oil', name: 'Palm oil (CPO)', densityKgPerL: 0.91, category: 'food', color: '#E76F51', temp: 'ambient', isFood: true, maxFillPct: 97, note: 'Often carried warm; density drops slightly when heated' },
  { id: 'vegetable-oil', name: 'Vegetable cooking oil', densityKgPerL: 0.92, category: 'food', color: '#F2CC8F', temp: 'ambient', isFood: true, maxFillPct: 97 },
  { id: 'milk', name: 'Milk', densityKgPerL: 1.03, category: 'food', color: '#F1F3F5', temp: 'chilled', isFood: true, maxFillPct: 98 },
  { id: 'fruit-juice', name: 'Fruit juice', densityKgPerL: 1.05, category: 'food', color: '#FFB703', temp: 'chilled', isFood: true, maxFillPct: 98 },
  { id: 'molasses', name: 'Molasses', densityKgPerL: 1.4, category: 'food', color: '#6F4518', temp: 'ambient', isFood: true, maxFillPct: 98 },
  { id: 'ethanol', name: 'Ethanol', densityKgPerL: 0.79, category: 'chemical', color: '#BDE0FE', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1170', hazClass: '3', packingGroup: 'II' }, maxFillPct: 97 },
  { id: 'methanol', name: 'Methanol', densityKgPerL: 0.792, category: 'chemical', color: '#A2D2FF', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1230', hazClass: '3', packingGroup: 'II' }, maxFillPct: 97, note: 'Subsidiary hazard 6.1 (toxic)' },
  { id: 'sulfuric-acid', name: 'Sulfuric acid 98 %', densityKgPerL: 1.84, category: 'chemical', color: '#FFD6A5', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1830', hazClass: '8', packingGroup: 'II' }, maxFillPct: 97 },
  { id: 'hydrochloric-acid', name: 'Hydrochloric acid 33 %', densityKgPerL: 1.16, category: 'chemical', color: '#FDFFB6', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1789', hazClass: '8', packingGroup: 'II' }, maxFillPct: 97 },
  { id: 'caustic-soda', name: 'Caustic soda solution 50 %', densityKgPerL: 1.52, category: 'chemical', color: '#E9ECEF', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1824', hazClass: '8', packingGroup: 'II' }, maxFillPct: 97 },
  { id: 'liquid-fertilizer', name: 'Liquid fertilizer (UAN 32)', densityKgPerL: 1.32, category: 'chemical', color: '#99D98C', temp: 'ambient', isFood: false, maxFillPct: 97 },
  { id: 'lpg', name: 'LPG (liquefied, pressurised)', densityKgPerL: 0.54, category: 'gas', color: '#90E0EF', temp: 'ambient', isFood: false, hazmat: { unNumber: 'UN1075', hazClass: '2.1' }, maxFillPct: 85, note: 'Pressure tank only; propane/butane mix' },
];

export const CUSTOM_LIQUID_ID = 'custom';

const BY_ID = new Map(LIQUIDS.map((l) => [l.id, l]));

/** Reference liquid by id (undefined for custom liquids). */
export function liquidDef(id: string): LiquidDef | undefined {
  return BY_ID.get(id);
}

/** Net weight of liquid contents, kg. */
export function liquidWeightKg(liquid: Pick<LiquidContents, 'volumeL' | 'densityKgPerL'>): number {
  return liquid.volumeL * liquid.densityKgPerL;
}

/** Highest safe fill for a liquid, % of brim capacity (97 % for unknown/custom liquids). */
export function maxFillPct(liquidId: string): number {
  return BY_ID.get(liquidId)?.maxFillPct ?? 97;
}

/** Display colour of a liquid (a neutral blue-grey for custom liquids). */
export function liquidColor(liquidId: string): string {
  return BY_ID.get(liquidId)?.color ?? '#8D99AE';
}
