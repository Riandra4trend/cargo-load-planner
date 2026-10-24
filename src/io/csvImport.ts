import Papa from 'papaparse';
import { PACKAGING_PRESETS } from '../data/packaging';
import { CUSTOM_LIQUID_ID, LIQUIDS, maxFillPct, type LiquidDef } from '../domain/liquids';
import { HAZMAT_CLASSES } from '../domain/settings';
import type { CargoLine, Dims, Hazmat, ItemSpec, LiquidContents, PackagingKind, PackingGroup, Plan, Priority, RotationRule, Shape, Stop, TempClass } from '../domain/types';
import { formatDensity, formatLiquidDensity, formatLitres, formatWeight, L_PER_US_GAL, lbToKg, toKg, toMetres, type LengthUnit, type WeightUnit } from '../domain/units';

/**
 * Bulk item import from CSV / TSV text (files or spreadsheet paste). Pure: parse -> auto-map columns ->
 * convert rows into cargo lines with a per-row report. The UI applies the result to the store.
 */

// --- parsing ----------------------------------------------------------------

export interface ParsedCsv {
  headers: string[];
  /** Data rows, each padded/truncated to the header length. */
  rows: string[][];
  delimiter: ',' | ';' | '\t';
}

/** Parses CSV, semicolon-separated or tab-separated text (pasted spreadsheet cells are TSV). Throws on empty input. */
export function parseCsvText(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  if (!firstLine) throw new Error('There is no data to import.');
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delimiter: ParsedCsv['delimiter'] = count('\t') > 0 ? '\t' : count(';') > count(',') ? ';' : ',';
  const result = Papa.parse<string[]>(clean, { delimiter, skipEmptyLines: 'greedy' });
  const data = result.data.filter((r) => r.some((c) => c.trim() !== ''));
  const headers = (data[0] ?? []).map((h) => h.trim());
  if (headers.every((h) => h === '')) throw new Error('The first row must contain column headers.');
  if (data.length < 2) throw new Error('Only a header row was found; add at least one item row.');
  const rows = data.slice(1).map((r) => headers.map((_, i) => r[i] ?? ''));
  return { headers, rows, delimiter };
}

// --- fields and auto-mapping ------------------------------------------------

export type ImportField =
  | 'name'
  | 'sku'
  | 'length'
  | 'width'
  | 'height'
  | 'weight'
  | 'quantity'
  | 'stop'
  | 'customer'
  | 'priority'
  | 'contents'
  | 'temp'
  | 'food'
  | 'stackable'
  | 'maxLoadOnTop'
  | 'layers'
  | 'fragile'
  | 'keepUpright'
  | 'rotation'
  | 'shape'
  | 'packaging'
  | 'palletHeight'
  | 'cogX'
  | 'cogY'
  | 'cogZ'
  | 'unNumber'
  | 'hazClass'
  | 'packingGroup'
  | 'category'
  | 'origin'
  | 'notes'
  | 'liquid'
  | 'volume'
  | 'density'
  | 'containerCapacity';

export type FieldKind = 'text' | 'length' | 'weight' | 'volume' | 'density' | 'integer' | 'boolean' | 'choice';

export interface FieldDef {
  field: ImportField;
  label: string;
  kind: FieldKind;
  group: 'Item' | 'Delivery' | 'Handling' | 'Liquid' | 'Hazmat' | 'Details';
  /** Required unless a liquid column is mapped (liquid rows derive size and weight). */
  required?: boolean;
}

export const IMPORT_FIELDS: FieldDef[] = [
  { field: 'name', label: 'Name / description', kind: 'text', group: 'Item' },
  { field: 'sku', label: 'SKU / article', kind: 'text', group: 'Item' },
  { field: 'length', label: 'Length', kind: 'length', group: 'Item', required: true },
  { field: 'width', label: 'Width', kind: 'length', group: 'Item', required: true },
  { field: 'height', label: 'Height', kind: 'length', group: 'Item', required: true },
  { field: 'weight', label: 'Weight per unit', kind: 'weight', group: 'Item', required: true },
  { field: 'quantity', label: 'Quantity', kind: 'integer', group: 'Item' },
  { field: 'stop', label: 'Stop / destination', kind: 'text', group: 'Delivery' },
  { field: 'customer', label: 'Customer', kind: 'text', group: 'Delivery' },
  { field: 'priority', label: 'Priority', kind: 'choice', group: 'Delivery' },
  { field: 'contents', label: 'Contents', kind: 'text', group: 'Delivery' },
  { field: 'temp', label: 'Temperature', kind: 'choice', group: 'Handling' },
  { field: 'food', label: 'Food', kind: 'boolean', group: 'Handling' },
  { field: 'stackable', label: 'Stackable', kind: 'boolean', group: 'Handling' },
  { field: 'maxLoadOnTop', label: 'Max load on top', kind: 'weight', group: 'Handling' },
  { field: 'layers', label: 'Max stack layers', kind: 'integer', group: 'Handling' },
  { field: 'fragile', label: 'Fragile', kind: 'boolean', group: 'Handling' },
  { field: 'keepUpright', label: 'Keep upright', kind: 'boolean', group: 'Handling' },
  { field: 'rotation', label: 'Rotation', kind: 'choice', group: 'Handling' },
  { field: 'shape', label: 'Shape', kind: 'choice', group: 'Handling' },
  { field: 'packaging', label: 'Packaging / container', kind: 'choice', group: 'Handling' },
  { field: 'palletHeight', label: 'Pallet height', kind: 'length', group: 'Handling' },
  { field: 'cogX', label: 'COG offset (length)', kind: 'length', group: 'Handling' },
  { field: 'cogY', label: 'COG offset (width)', kind: 'length', group: 'Handling' },
  { field: 'cogZ', label: 'COG offset (height)', kind: 'length', group: 'Handling' },
  { field: 'unNumber', label: 'UN number', kind: 'text', group: 'Hazmat' },
  { field: 'hazClass', label: 'Hazmat class', kind: 'text', group: 'Hazmat' },
  { field: 'packingGroup', label: 'Packing group', kind: 'choice', group: 'Hazmat' },
  { field: 'category', label: 'Category', kind: 'text', group: 'Details' },
  { field: 'origin', label: 'Origin', kind: 'text', group: 'Details' },
  { field: 'notes', label: 'Notes', kind: 'text', group: 'Details' },
  { field: 'liquid', label: 'Liquid (name or id)', kind: 'text', group: 'Liquid' },
  { field: 'volume', label: 'Volume per unit', kind: 'volume', group: 'Liquid' },
  { field: 'density', label: 'Density', kind: 'density', group: 'Liquid' },
  { field: 'containerCapacity', label: 'Container capacity (other container)', kind: 'volume', group: 'Liquid' },
];

/** Fields that still need a column. Liquid rows derive size from the container and weight from volume × density. */
export function missingRequiredFields(mapping: FieldMapping): FieldDef[] {
  if (mapping.liquid !== undefined) return [];
  return IMPORT_FIELDS.filter((f) => f.required && mapping[f.field] === undefined);
}

/** Normalised header keys (lowercase, alphanumerics only, unit suffix removed) per field. */
const ALIASES: Record<ImportField, string[]> = {
  name: ['name', 'item', 'itemname', 'description', 'desc', 'itemdescription', 'product', 'productname', 'goods', 'title'],
  sku: ['sku', 'article', 'articleno', 'articlenumber', 'artno', 'itemno', 'itemnumber', 'itemcode', 'partno', 'partnumber', 'productcode', 'code', 'ref', 'reference'],
  length: ['length', 'l', 'len', 'lng'],
  width: ['width', 'w', 'wid', 'breadth'],
  height: ['height', 'h', 'ht', 'hgt'],
  weight: ['weight', 'grossweight', 'gross', 'wt', 'mass', 'unitweight', 'weightperunit', 'grossweightperunit', 'weighteach', 'gw'],
  quantity: ['qty', 'quantity', 'count', 'pcs', 'pieces', 'units', 'numberofunits', 'noofunits', 'amount', 'pallets', 'packages'],
  stop: ['stop', 'stopname', 'destination', 'dest', 'deliverystop', 'drop', 'deliverto', 'delivery', 'stopno', 'stopnumber'],
  customer: ['customer', 'customername', 'client', 'consignee', 'receiver', 'recipient', 'buyer'],
  priority: ['priority', 'prio', 'urgency'],
  contents: ['contents', 'content', 'innerqty', 'cartons'],
  temp: ['temp', 'temperature', 'tempclass', 'temperatureclass', 'tempzone', 'temperaturezone', 'temprange'],
  food: ['food', 'isfood', 'foodstuff', 'foodgrade', 'foodstuffs'],
  stackable: ['stackable', 'stack', 'canstack', 'stacking'],
  maxLoadOnTop: ['maxloadontop', 'loadontop', 'maxtopload', 'topload', 'maxload', 'maxstackweight', 'stackweight', 'maxweightontop'],
  layers: ['layers', 'maxlayers', 'maxstacklayers', 'stacklayers', 'maxstack', 'tiers', 'maxtiers'],
  fragile: ['fragile', 'breakable'],
  keepUpright: ['keepupright', 'upright', 'thissideup', 'thiswayup'],
  rotation: ['rotation', 'rotate', 'rotations', 'allowedrotation', 'allowedrotations', 'orientation'],
  shape: ['shape', 'form'],
  packaging: ['packaging', 'package', 'packagetype', 'packagingtype', 'packtype', 'pallettype', 'pallet', 'handlingunit', 'container', 'containertype'],
  palletHeight: ['palletheight', 'palleth'],
  cogX: ['cogoffsetx', 'cogx', 'cogxoffset', 'cogoffsetl', 'coglength'],
  cogY: ['cogoffsety', 'cogy', 'cogyoffset', 'cogoffsetw', 'cogwidth'],
  cogZ: ['cogoffsetz', 'cogz', 'cogzoffset', 'cogoffseth', 'cogheight'],
  unNumber: ['un', 'unnumber', 'unno', 'unid', 'unnr', 'idnumber'],
  hazClass: ['class', 'hazmatclass', 'hazardclass', 'hazclass', 'dgclass', 'adrclass', 'hazmat', 'division', 'dangerousgoodsclass'],
  packingGroup: ['packinggroup', 'pg', 'packgroup'],
  category: ['category', 'cat', 'type', 'producttype', 'commodity'],
  origin: ['origin', 'countryoforigin', 'coo', 'country', 'madein'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comment', 'comments', 'instructions'],
  liquid: ['liquid', 'liquidtype', 'liquidname', 'liquidid', 'fluid', 'fluidtype'],
  volume: ['volume', 'vol', 'volumeperunit', 'fillvolume', 'fill', 'netvolume', 'volumeusgal'],
  density: ['density', 'sg', 'specificgravity', 'densitykgl', 'densitykgperl', 'densitylbgal', 'densitylbpergal', 'densitykgm3', 'densitykgperm3'],
  containerCapacity: ['containercapacity', 'containercapacityl', 'capacity', 'containervolume', 'brimcapacity'],
};

const FIELD_BY_ALIAS = new Map<string, ImportField>(
  (Object.entries(ALIASES) as [ImportField, string[]][]).flatMap(([field, keys]) => keys.map((k) => [k, field] as const)),
);

/** Fallback for unmatched headers: substring -> field, tried in order (e.g. "Gross weight per pallet"). */
const CONTAINS: [string, ImportField][] = [
  ['density', 'density'],
  ['containercapacity', 'containerCapacity'],
  ['volume', 'volume'],
  ['liquid', 'liquid'],
  ['palletheight', 'palletHeight'],
  ['loadontop', 'maxLoadOnTop'],
  ['weight', 'weight'],
  ['length', 'length'],
  ['width', 'width'],
  ['height', 'height'],
  ['quantity', 'quantity'],
  ['qty', 'quantity'],
  ['description', 'name'],
  ['destination', 'stop'],
  ['customer', 'customer'],
  ['stop', 'stop'],
  ['temperature', 'temp'],
  ['hazard', 'hazClass'],
  ['sku', 'sku'],
  ['name', 'name'],
];

export type VolumeUnit = 'L' | 'gal';
export type DensityUnit = 'kg/L' | 'lb/gal' | 'kg/m3';
export const VOLUME_UNITS: VolumeUnit[] = ['L', 'gal'];
export const DENSITY_UNITS: DensityUnit[] = ['kg/L', 'lb/gal', 'kg/m3'];

type UnitToken = { kind: 'length'; unit: LengthUnit } | { kind: 'weight'; unit: WeightUnit } | { kind: 'volume'; unit: VolumeUnit };

const UNIT_TOKENS: Record<string, UnitToken> = {};
const addTokens = (token: UnitToken, words: string[]) => words.forEach((w) => (UNIT_TOKENS[w] = token));
addTokens({ kind: 'length', unit: 'mm' }, ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']);
addTokens({ kind: 'length', unit: 'cm' }, ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres']);
addTokens({ kind: 'length', unit: 'm' }, ['m', 'meter', 'meters', 'metre', 'metres']);
addTokens({ kind: 'length', unit: 'in' }, ['in', 'inch', 'inches', '"']);
addTokens({ kind: 'length', unit: 'ft' }, ['ft', 'foot', 'feet']);
addTokens({ kind: 'weight', unit: 'kg' }, ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms']);
addTokens({ kind: 'weight', unit: 't' }, ['t', 'ton', 'tons', 'tonne', 'tonnes']);
addTokens({ kind: 'weight', unit: 'lb' }, ['lb', 'lbs', 'pound', 'pounds']);
addTokens({ kind: 'volume', unit: 'L' }, ['l', 'lt', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters']);
addTokens({ kind: 'volume', unit: 'gal' }, ['gal', 'gals', 'gallon', 'gallons', 'usgal']);

/** Header -> normalised key and the unit named in it ("Length (in)", "weight_kg", "Height [mm]"). */
function analyseHeader(header: string): { key: string; unit?: UnitToken } {
  const h = header.trim().toLowerCase();
  if (h.length > 1 && UNIT_TOKENS[h]) return { key: '', unit: UNIT_TOKENS[h] };
  const m = /^(.*?)\s*[([]\s*([a-z"]+)\.?\s*[)\]]$/.exec(h) ?? /^(.*?)[\s_\-/]+([a-z"]+)\.?$/.exec(h);
  const unit = m ? UNIT_TOKENS[m[2]] : undefined;
  const base = unit && m ? m[1] : h;
  return { key: base.replace(/[^a-z0-9]/g, ''), unit };
}

/** Source column index per target field. */
export type FieldMapping = Partial<Record<ImportField, number>>;

export interface AutoMapResult {
  mapping: FieldMapping;
  /** Unit named in the dimension headers, if any. */
  lengthUnit?: LengthUnit;
  /** Unit named in the weight headers, if any. */
  weightUnit?: WeightUnit;
  /** Unit named in the volume header ("Volume (gal)", "volume_l", "Litres"), if any. */
  volumeUnit?: VolumeUnit;
  /** Unit named in the density header ("Density (lb/gal)"), if any. */
  densityUnit?: DensityUnit;
}

const LENGTH_FIELDS: ImportField[] = ['length', 'width', 'height', 'palletHeight', 'cogX', 'cogY', 'cogZ'];
const WEIGHT_FIELDS: ImportField[] = ['weight', 'maxLoadOnTop'];
const VOLUME_FIELDS: ImportField[] = ['volume', 'containerCapacity'];

/** Density unit written in a header or cell: "lb/gal", "kg/m3", "kg/L". */
function densityUnitIn(text: string): DensityUnit | undefined {
  const t = text.toLowerCase().replace(/\s+/g, '');
  if (/lbs?(\/|per)(us)?gal/.test(t)) return 'lb/gal';
  if (/kg(\/|per)m(3|³)/.test(t)) return 'kg/m3';
  if (/(kg(\/|per)l|g\/ml|g\/cm(3|³))/.test(t)) return 'kg/L';
  return undefined;
}

/** Maps headers to fields by case/space-insensitive aliases; detects unit suffixes. */
export function autoMapColumns(headers: string[]): AutoMapResult {
  const analysed = headers.map(analyseHeader);
  const mapping: FieldMapping = {};
  const used = new Set<number>();
  const assign = (field: ImportField, i: number) => {
    if (mapping[field] !== undefined || used.has(i)) return;
    mapping[field] = i;
    used.add(i);
  };
  analysed.forEach(({ key, unit }, i) => {
    const field = FIELD_BY_ALIAS.get(key) ?? (key === '' && unit?.kind === 'weight' ? 'weight' : key === '' && unit?.kind === 'volume' ? 'volume' : undefined);
    if (field) assign(field, i);
  });
  analysed.forEach(({ key }, i) => {
    if (used.has(i) || !key) return;
    const hit = CONTAINS.find(([needle, field]) => key.includes(needle) && mapping[field] === undefined);
    if (hit) assign(hit[1], i);
  });
  const unitOf = (fields: ImportField[], kind: UnitToken['kind']) => {
    for (const f of fields) {
      const i = mapping[f];
      const u = i === undefined ? undefined : analysed[i].unit;
      if (u?.kind === kind) return u.unit;
    }
    return undefined;
  };
  const volumeUnit =
    (unitOf(VOLUME_FIELDS, 'volume') as VolumeUnit | undefined) ??
    (mapping.volume !== undefined && /gal/i.test(headers[mapping.volume]) ? 'gal' : undefined);
  return {
    mapping,
    lengthUnit: unitOf(LENGTH_FIELDS, 'length') as LengthUnit | undefined,
    weightUnit: unitOf(WEIGHT_FIELDS, 'weight') as WeightUnit | undefined,
    volumeUnit,
    densityUnit: mapping.density === undefined ? undefined : densityUnitIn(headers[mapping.density]),
  };
}

// --- cell parsers -------------------------------------------------------------

/**
 * Number typed in any common locale: "1200", "1,200.5", "1.200,5", "1,5" (decimal comma), "1 200".
 * A single comma followed by exactly three digits ("1,450") is read as a thousands separator. NaN when invalid.
 */
export function parseNumberCell(text: string): number {
  let t = text.trim().replace(/[\s\u00a0\u202f']/g, '');
  if (t === '') return Number.NaN;
  const comma = t.lastIndexOf(',');
  const dot = t.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (comma >= 0) t = /^[-+]?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : Number.NaN;
}

type MeasureKind = UnitToken['kind'];
type MeasureUnit = LengthUnit | WeightUnit | VolumeUnit;

/** Length, weight or volume cell in SI (m, kg, L); a unit written in the cell ("48 in", "1200mm", "500 lb", "264 gal") overrides the column unit. */
function parseMeasure(text: string, kind: MeasureKind, unit: MeasureUnit): number | string {
  let value = text.trim();
  let u = unit;
  const m = /^(.*?\d)\s*([a-z]+|")\.?$/i.exec(value);
  if (m) {
    const token = UNIT_TOKENS[m[2].toLowerCase()];
    if (!token) return `unknown unit "${m[2]}"`;
    if (token.kind !== kind) return `"${m[2]}" is not a ${kind} unit`;
    u = token.unit;
    value = m[1];
  }
  const n = parseNumberCell(value);
  if (!Number.isFinite(n)) return 'is not a number';
  if (kind === 'volume') return u === 'gal' ? n * L_PER_US_GAL : n;
  return kind === 'length' ? toMetres(n, u as LengthUnit) : toKg(n, u as WeightUnit);
}

/** Density cell in kg/L; a unit written in the cell ("7.0 lb/gal", "840 kg/m3") overrides the column unit. */
function parseDensity(text: string, unit: DensityUnit): number | string {
  const m = /^([-+]?[\d.,\s]*\d)\s*(.*)$/.exec(text.trim());
  if (!m) return 'is not a number';
  const n = parseNumberCell(m[1]);
  if (!Number.isFinite(n)) return 'is not a number';
  const written = m[2].trim();
  const u = written ? densityUnitIn(written) : unit;
  if (!u) return `unknown density unit "${written}"`;
  if (u === 'lb/gal') return lbToKg(n) / L_PER_US_GAL;
  return u === 'kg/m3' ? n / 1000 : n;
}

const liquidKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Lookup keys per library liquid: id, full name, name without its bracketed part, and each bracketed / slash-separated alias. */
const LIQUID_BY_KEY = new Map<string, LiquidDef>();
for (const def of LIQUIDS) {
  const bracket = /\(([^)]*)\)/.exec(def.name)?.[1] ?? '';
  const keys = [def.id, def.name, def.name.replace(/\([^)]*\)/, ''), ...def.name.split('/'), ...bracket.split(/[,/]/)];
  for (const k of keys.map(liquidKey)) if (k && !LIQUID_BY_KEY.has(k)) LIQUID_BY_KEY.set(k, def);
}

/** Library liquid by id or name, case-insensitive ("diesel", "Diesel (solar)", "solar", "crude oil", "CPO"). */
export function findLiquid(text: string): LiquidDef | undefined {
  return LIQUID_BY_KEY.get(liquidKey(text));
}

const BOOL_WORDS: Record<string, boolean> = {
  yes: true, y: true, true: true, t: true, '1': true, x: true, ja: true, oui: true, si: true, sí: true, on: true, '✓': true, '✔': true,
  no: false, n: false, false: false, f: false, '0': false, nein: false, non: false, off: false, '-': false,
};

/** yes/no/true/false/1/0/x; undefined for an empty cell, null when unrecognised. */
export function parseBoolCell(text: string): boolean | undefined | null {
  const t = text.trim().toLowerCase();
  if (t === '') return undefined;
  return Object.hasOwn(BOOL_WORDS, t) ? BOOL_WORDS[t] : null;
}

/** Temperature class from words ("frozen", "reefer", "dry") or a set-point in °C ("-18", "+2..+4 °C"). */
export function parseTempCell(text: string): TempClass | null {
  const t = text.trim().toLowerCase();
  if (t === '' || /^(ambient|amb|dry|normal|none|room|general|ambient temp(erature)?|a)$/.test(t)) return 'ambient';
  if (/^(chilled|chill|chiller|cool|cooled|refrigerated|fresh|cold|c|chilled\s*\(.*\))$/.test(t)) return 'chilled';
  if (/^(frozen|freeze|freezer|deep[\s-]?frozen|deepfreeze|fz|f|frozen\s*\(.*\))$/.test(t)) return 'frozen';
  const n = /^([-+−]?\d+(?:[.,]\d+)?)/.exec(t.replace('−', '-'));
  if (!n) return null;
  const c = parseNumberCell(n[1]);
  if (!Number.isFinite(c)) return null;
  if (c <= -10) return 'frozen';
  if (c <= 8) return 'chilled';
  return 'ambient';
}

function parseChoice<T extends string>(text: string, table: [RegExp, T][]): T | null {
  const t = text.trim().toLowerCase();
  return table.find(([re]) => re.test(t))?.[1] ?? null;
}

const ROTATIONS: [RegExp, RotationRule][] = [
  [/^(none|no|fixed|locked|0|no rotation|not allowed)$/, 'none'],
  [/^(yaw|vertical|vertical axis|turn|turnable|z|horizontal only|floor|90|2)$/, 'yaw'],
  [/^(any|all|free|6|all 6|all orientations|yes)$/, 'any'],
];
const SHAPES: [RegExp, Shape][] = [
  [/^(box|carton|cuboid|rectangular|pallet|crate)$/, 'box'],
  [/^(cylinder-upright|upright cylinder|cylinder upright|drum|barrel|cylinder|keg|upright)$/, 'cylinder-upright'],
  [/^(cylinder-lying|lying cylinder|cylinder lying|roll|coil|reel|lying)$/, 'cylinder-lying'],
];
const PACKAGING: [RegExp, PackagingKind][] = [
  [/^(eur-pallet|eur|euro|euro pallet|eur pallet|epal|eur1|europallet)$/, 'eur-pallet'],
  [/^(eur-half|half|half pallet|eur half|eur6|euro half)$/, 'eur-half'],
  [/^(industrial-pallet|industrial|industrial pallet|1200x1000|block pallet)$/, 'industrial-pallet'],
  [/^(us-pallet|us pallet|gma|gma pallet|48x40|us)$/, 'us-pallet'],
  [/^(carton|box|cardboard|case)$/, 'carton'],
  [/^(crate|wooden crate|skid)$/, 'crate'],
  [/^(drum|barrel|steel drum|200 l drum|200l drum|200 l|200l)$/, 'drum'],
  [/^(ibc|tote|ibc tote|ibc tote 1000 l|1000 l ibc)$/, 'ibc'],
  [/^(jerrycan|jerry can|jerry-can|jerrycan 20 l|can|20 l can)$/, 'jerrycan'],
  [/^(bulk-liquid|bulk|bulk liquid|tanker|tank|tanker compartment|compartment)$/, 'bulk-liquid'],
  [/^(long-goods|long goods|long|bundle|profiles)$/, 'long-goods'],
  [/^(custom|other|other container|none|loose)$/, 'custom'],
];
const PRIORITIES: [RegExp, Priority][] = [
  [/^(urgent|high|rush|express|asap|yes|y|1|true|x)$/, 'urgent'],
  [/^(normal|standard|low|regular|no|n|0|false)$/, 'normal'],
];

/** "UN3480", "3480", "un 1263", "NA1993" -> "UN3480" / "NA1993"; null when malformed. */
export function normaliseUnNumber(text: string): string | null {
  const m = /^(UN|NA)?\s*-?\s*(\d{4})$/i.exec(text.trim());
  return m ? `${(m[1] ?? 'UN').toUpperCase()}${m[2]}` : null;
}

/** "3", "Class 2.1", "5.1 (oxidiser)" -> "3" / "2.1" / "5.1"; null when not a known class or division. */
export function normaliseHazClass(text: string): string | null {
  const m = /(?<![\d.])(\d(?:\.\d)?)(?![\d.])/.exec(text.trim());
  return m && HAZMAT_CLASSES.includes(m[1]) ? m[1] : null;
}

function parsePackingGroup(text: string): PackingGroup | null {
  const t = text.trim().toUpperCase().replace(/^PG\s*/, '');
  return ({ I: 'I', II: 'II', III: 'III', '1': 'I', '2': 'II', '3': 'III' } as Record<string, PackingGroup>)[t] ?? null;
}

// --- rows -> lines ------------------------------------------------------------

export interface ImportUnits {
  lengthUnit: LengthUnit;
  weightUnit: WeightUnit;
  volumeUnit: VolumeUnit;
  densityUnit: DensityUnit;
}

export interface ImportReportEntry {
  /** Spreadsheet row number (the header is row 1); 0 for messages about the whole file. */
  row: number;
  level: 'error' | 'warning' | 'info';
  message: string;
}

/** A stop the import will create; lines refer to it through `key` until bound (see bindNewStops). */
export interface NewStop {
  key: string;
  name: string;
  customerName: string;
}

export interface ImportResult {
  lines: Omit<CargoLine, 'id'>[];
  /** Spreadsheet row number of each line. */
  rowOfLine: number[];
  newStops: NewStop[];
  report: ImportReportEntry[];
  /** Rows skipped because of errors. */
  skipped: number;
}

const NEW_STOP_PREFIX = 'new-stop:';
const MAX_QUANTITY = 1000;
const LARGE_QUANTITY = 300;
/** Nominal box of a bulk fill (ignored by packing; matches makeBulkLiquidSpec). */
const BULK_DIMS: Dims = { l: 1, w: 1, h: 1 };
/** Plausible liquid densities, kg/L (LPG 0.54 … sulfuric acid 1.84, with margin). */
const MIN_DENSITY = 0.3;
const MAX_DENSITY = 3;

/** Converts parsed rows into cargo lines (SI units) with validation; rows with errors are skipped. */
export function rowsToLines(rows: string[][], mapping: FieldMapping, units: ImportUnits, plan: Plan): ImportResult {
  const report: ImportReportEntry[] = [];
  const lines: ImportResult['lines'] = [];
  const rowOfLine: number[] = [];
  const newStops: NewStop[] = [];
  const sys = plan.settings.units;
  const stops = [...plan.stops].sort((a, b) => a.sequence - b.sequence);
  const customerName = (s: Stop) => plan.customers.find((c) => c.id === s.customerId)?.name ?? '';
  let skipped = 0;

  for (const f of missingRequiredFields(mapping)) report.push({ row: 0, level: 'error', message: `No column is mapped to ${f.label.toLowerCase()}.` });
  if (mapping.stop === undefined && mapping.customer === undefined && stops[0]) {
    report.push({ row: 0, level: 'info', message: `No stop column: items go to stop ${stops[0].sequence} (${stops[0].name}).` });
  }

  const newStopKey = (name: string, customer: string): string => {
    const existing = newStops.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.key;
    const stop: NewStop = { key: `${NEW_STOP_PREFIX}${newStops.length}`, name, customerName: customer || name };
    newStops.push(stop);
    return stop.key;
  };

  rows.forEach((row, index) => {
    const rowNo = index + 2;
    if (row.every((c) => c.trim() === '')) return;
    const errors: string[] = [];
    const warnings: string[] = [];
    const cell = (f: ImportField): string => {
      const i = mapping[f];
      return i === undefined ? '' : (row[i] ?? '').trim();
    };
    const label = (f: ImportField) => IMPORT_FIELDS.find((d) => d.field === f)!.label;

    const measure = (f: ImportField, kind: MeasureKind, opts: { required?: boolean; positive?: boolean; signed?: boolean }): number | undefined => {
      const text = cell(f);
      if (text === '') {
        if (opts.required) errors.push(`${label(f)} is missing`);
        return undefined;
      }
      const v = parseMeasure(text, kind, kind === 'length' ? units.lengthUnit : kind === 'weight' ? units.weightUnit : units.volumeUnit);
      if (typeof v === 'string') {
        errors.push(`${label(f)} "${text}" ${v}`);
        return undefined;
      }
      if (opts.positive && v <= 0) errors.push(`${label(f)} must be greater than 0`);
      else if (!opts.signed && v < 0) errors.push(`${label(f)} must not be negative`);
      return v;
    };
    const integer = (f: ImportField, fallback: number, min: number): number => {
      const text = cell(f);
      if (text === '') return fallback;
      const n = parseNumberCell(text);
      if (!Number.isInteger(n) || n < min) {
        errors.push(`${label(f)} "${text}" must be a whole number of at least ${min}`);
        return fallback;
      }
      return n;
    };
    const bool = (f: ImportField, fallback: boolean): boolean => {
      const b = parseBoolCell(cell(f));
      if (b === null) {
        warnings.push(`${label(f)} "${cell(f)}" not recognised (use yes/no); using ${fallback ? 'yes' : 'no'}`);
        return fallback;
      }
      return b ?? fallback;
    };
    const choice = <T extends string>(f: ImportField, parse: (t: string) => T | null, fallback: T): T => {
      const text = cell(f);
      if (text === '') return fallback;
      const v = parse(text);
      if (v === null) warnings.push(`${label(f)} "${text}" not recognised; using ${fallback}`);
      return v ?? fallback;
    };

    // packaging and liquid contents decide which columns a row needs
    const liquidText = cell('liquid');
    const def = liquidText ? findLiquid(liquidText) : undefined;
    const dimsGiven = cell('length') !== '' || cell('width') !== '' || cell('height') !== '';
    const packaging = choice('packaging', (t) => parseChoice(t, PACKAGING), liquidText && !dimsGiven ? 'bulk-liquid' : 'custom');
    const preset = PACKAGING_PRESETS[packaging];
    const bulk = packaging === 'bulk-liquid';
    const isLiquid = liquidText !== '' || bulk;

    let liquid: LiquidContents | undefined;
    if (isLiquid) {
      if (!liquidText) errors.push('A bulk liquid row needs a liquid, e.g. diesel or water');
      let volumeL = measure('volume', 'volume', { positive: true });
      if (cell('volume') === '') {
        if (!bulk && preset.nominalL) volumeL = preset.nominalL;
        else errors.push('Volume is missing');
      }
      const densityText = cell('density');
      let densityKgPerL = def?.densityKgPerL;
      if (densityText) {
        const d = parseDensity(densityText, units.densityUnit);
        if (typeof d === 'string') errors.push(`Density "${densityText}" ${d}`);
        else if (d < MIN_DENSITY || d > MAX_DENSITY) errors.push(`Density ${formatLiquidDensity(d, sys)} is implausible for a liquid: check the density unit`);
        else densityKgPerL = d;
      } else if (liquidText && !def) errors.push(`"${liquidText}" is not in the liquid library: add a density column`);
      let containerCapacityL: number | undefined;
      if (cell('containerCapacity') !== '') {
        if (bulk) warnings.push('Container capacity is ignored for bulk liquids');
        else if (preset.capacityL) warnings.push(`Container capacity is ignored: a ${preset.label} holds ${formatLitres(preset.capacityL, sys, 0)}`);
        else containerCapacityL = measure('containerCapacity', 'volume', { positive: true });
      }
      if (liquidText && volumeL !== undefined && densityKgPerL !== undefined) {
        liquid = { liquidId: def?.id ?? CUSTOM_LIQUID_ID, name: def?.name ?? liquidText, densityKgPerL, volumeL, ...(containerCapacityL ? { containerCapacityL } : {}) };
        const brim = bulk ? undefined : (preset.capacityL ?? containerCapacityL);
        const pct = maxFillPct(liquid.liquidId);
        if (brim && volumeL > (brim * pct) / 100 + 1e-6) {
          warnings.push(`Overfilled: ${formatLitres(volumeL, sys, 0)} in a ${formatLitres(brim, sys, 0)} container (max ${formatLitres((brim * pct) / 100, sys, 0)} at ${pct} %)`);
        }
      }
    }

    // identity
    let name = cell('name') || def?.name || liquidText;
    if (!name) {
      name = cell('sku') || `Item (row ${rowNo})`;
      warnings.push(`No name; using "${name}"`);
    }

    // physical: liquid rows fall back to the container's size and derive the weight from volume × density
    let l = measure('length', 'length', { required: !isLiquid, positive: true });
    let w = measure('width', 'length', { required: !isLiquid, positive: true });
    let h = measure('height', 'length', { required: !isLiquid, positive: true });
    if (isLiquid && (l === undefined || w === undefined || h === undefined)) {
      const fallback = bulk ? BULK_DIMS : preset.dims;
      if (fallback) {
        l ??= fallback.l;
        w ??= fallback.w;
        h ??= fallback.h;
      } else errors.push('Length, width and height are missing, and this container has no standard size');
    }
    let weightKg = measure('weight', 'weight', { required: !isLiquid, positive: true });
    if (liquid) {
      const computed = liquid.volumeL * liquid.densityKgPerL + (bulk ? 0 : preset.tareKg);
      if (cell('weight') === '') weightKg = computed;
      else if (weightKg !== undefined && Math.abs(weightKg - computed) > 0.1 * computed) {
        warnings.push(`Weight ${formatWeight(weightKg, sys)} differs from volume × density${bulk ? '' : ' + container'} (${formatWeight(computed, sys)})`);
      }
    }
    const quantity = integer('quantity', 1, 1);
    if (quantity > MAX_QUANTITY) errors.push(`Quantity ${quantity} is above the import limit of ${MAX_QUANTITY} units per row`);
    else if (quantity > LARGE_QUANTITY) warnings.push(`Large quantity (${quantity} units)`);
    const palletHeight = measure('palletHeight', 'length', {}) ?? 0;
    if (h !== undefined && palletHeight >= h) errors.push('Pallet height must be less than the total height');
    const cog = {
      x: measure('cogX', 'length', { signed: true }) ?? 0,
      y: measure('cogY', 'length', { signed: true }) ?? 0,
      z: measure('cogZ', 'length', { signed: true }) ?? 0,
    };
    if ((l !== undefined && Math.abs(cog.x) > l / 2) || (w !== undefined && Math.abs(cog.y) > w / 2) || (h !== undefined && Math.abs(cog.z) > h / 2)) {
      errors.push('COG offset lies outside the item');
    }

    // handling
    const stackable = bool('stackable', false);
    const maxLoadOnTopKg = measure('maxLoadOnTop', 'weight', {}) ?? (stackable && weightKg !== undefined ? weightKg : 0);
    const maxStackLayers = integer('layers', stackable ? 2 : 1, 1);
    const fragile = bool('fragile', false);
    const keepUpright = bool('keepUpright', true);
    const rotation = choice('rotation', (t) => parseChoice(t, ROTATIONS), bulk ? 'none' : 'yaw');
    const shape = choice('shape', (t) => parseChoice(t, SHAPES), preset.shape);
    const temp = choice('temp', parseTempCell, def?.temp ?? 'ambient');
    const isFood = bool('food', def?.isFood ?? false);
    const priority = choice('priority', (t) => parseChoice(t, PRIORITIES), 'normal');

    // hazmat
    let hazmat: Hazmat | undefined;
    const unText = cell('unNumber');
    const classText = cell('hazClass');
    if (unText || classText) {
      const unNumber = unText ? normaliseUnNumber(unText) : null;
      const hazClass = classText ? normaliseHazClass(classText) : null;
      if (unText && !unNumber) errors.push(`UN number "${unText}" must be 4 digits, e.g. UN3480`);
      if (classText && !hazClass) errors.push(`Hazmat class "${classText}" is not a known class or division`);
      if (!unText) errors.push(`Hazmat class ${classText} needs a UN number`);
      if (!classText) errors.push(`UN number ${unText} needs a hazmat class`);
      if (unNumber && hazClass) {
        hazmat = { unNumber, hazClass };
        const pgText = cell('packingGroup');
        if (pgText) {
          const pg = parsePackingGroup(pgText);
          if (pg) hazmat.packingGroup = pg;
          else warnings.push(`Packing group "${pgText}" not recognised (I, II or III); left empty`);
        }
      }
    } else if (def?.hazmat) hazmat = { ...def.hazmat };

    if (errors.length || l === undefined || w === undefined || h === undefined || weightKg === undefined) {
      skipped++;
      for (const message of errors) report.push({ row: rowNo, level: 'error', message });
      return;
    }

    // stop
    let stopId: string;
    const stopText = cell('stop');
    const customerText = cell('customer');
    if (stopText) {
      const seq = /^(?:stop\s*)?#?(\d+)$/i.exec(stopText);
      const lower = stopText.toLowerCase();
      const byCustomer = stops.filter((s) => customerName(s).trim().toLowerCase() === lower);
      const found =
        (seq ? stops.find((s) => s.sequence === Number(seq[1])) : undefined) ??
        stops.find((s) => s.name.trim().toLowerCase() === lower) ??
        (byCustomer.length === 1 ? byCustomer[0] : undefined);
      if (found) stopId = found.id;
      else {
        const isNew = !newStops.some((s) => s.name.toLowerCase() === lower);
        stopId = newStopKey(stopText, customerText);
        if (isNew) warnings.push(`Unknown stop "${stopText}": a new stop will be created`);
      }
    } else if (customerText) {
      const found = stops.find((s) => customerName(s).trim().toLowerCase() === customerText.toLowerCase());
      if (found) stopId = found.id;
      else {
        const isNew = !newStops.some((s) => s.name.toLowerCase() === customerText.toLowerCase());
        stopId = newStopKey(customerText, customerText);
        if (isNew) warnings.push(`Unknown customer "${customerText}": a new stop will be created`);
      }
    } else if (stops[0]) {
      stopId = stops[0].id;
      if (mapping.stop !== undefined) warnings.push(`No stop given; assigned to stop ${stops[0].sequence}`);
    } else {
      stopId = newStopKey('Stop 1', 'Customer 1');
    }

    if (!bulk) {
      const density = weightKg / (l * w * h);
      if (density < 10 || density > 8000) warnings.push(`Implausible density ${formatDensity(density, sys)}: check units`);
    }
    if (fragile && stackable) warnings.push('Fragile and stackable: nothing will be stacked on it');
    for (const message of warnings) report.push({ row: rowNo, level: 'warning', message });

    const notes = cell('notes');
    const contents = cell('contents');
    const spec: ItemSpec = {
      name,
      sku: cell('sku'),
      category: cell('category') || (bulk ? 'Bulk liquid' : ''),
      origin: cell('origin'),
      shape,
      dims: { l, w, h },
      weightKg,
      cogOffset: cog,
      packaging,
      palletHeight,
      stackable,
      maxLoadOnTopKg,
      maxStackLayers,
      fragile,
      keepUpright,
      rotation,
      temp,
      isFood,
      ...(notes ? { notes } : {}),
      ...(hazmat ? { hazmat } : {}),
      ...(liquid ? { liquid } : {}),
    };
    lines.push({ spec, quantity, stopId, priority, ...(contents ? { contents } : {}) });
    rowOfLine.push(rowNo);
  });

  return { lines, rowOfLine, newStops, report, skipped };
}

/** Replaces new-stop keys in imported lines with the ids of the stops created for them (same order as newStops). */
export function bindNewStops(lines: Omit<CargoLine, 'id'>[], newStops: NewStop[], stopIds: string[]): Omit<CargoLine, 'id'>[] {
  const idByKey = new Map(newStops.map((s, i) => [s.key, stopIds[i]]));
  return lines.map((l) => (idByKey.has(l.stopId) ? { ...l, stopId: idByKey.get(l.stopId)! } : l));
}
