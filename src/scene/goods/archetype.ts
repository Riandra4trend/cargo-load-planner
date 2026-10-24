import type { ItemSpec } from '../../domain/types';

/** Visual archetypes of the procedural goods generator. */
export type GoodsArchetype =
  | 'pallet-cartons'
  | 'frozen-cartons'
  | 'dairy-crates'
  | 'produce-crates'
  | 'beverages'
  | 'pails'
  | 'batteries'
  | 'tv-boxes'
  | 'wooden-crate'
  | 'glass-crate'
  | 'machine'
  | 'steel-bundle'
  | 'drum'
  | 'paper-roll'
  | 'cable-reel'
  | 'ibc'
  | 'bricks'
  | 'furniture'
  | 'carton'
  | 'custom';

const has = (text: string, re: RegExp): boolean => re.test(text);

/** Picks the look of a unit from its shape, packaging, name/category keywords, temperature and handling flags. */
export function goodsArchetype(spec: ItemSpec): GoodsArchetype {
  const text = `${spec.name} ${spec.category}`.toLowerCase();
  const palletized = spec.palletHeight > 0;
  if (spec.shape === 'cylinder-lying') return has(text, /cable|reel|wire|spool|hose/) ? 'cable-reel' : 'paper-roll';
  if (spec.shape === 'cylinder-upright') return has(text, /pail|bucket/) ? 'pails' : 'drum';
  if (spec.packaging === 'ibc' || has(text, /\bibc\b|\btote\b/)) return 'ibc';
  if (spec.packaging === 'drum' || has(text, /\bdrums?\b|barrel/)) return 'drum';
  if (spec.packaging === 'long-goods' || has(text, /profile|\bbars?\b|pipe|tube|beam|rebar|girder|rail/)) return 'steel-bundle';
  if (spec.hazmat?.hazClass === '9' || has(text, /batter/)) return 'batteries';
  if (has(text, /glass|mirror|window pane|windscreen/)) return 'glass-crate';
  if (has(text, /\btvs?\b|television|monitor|flat-screen|screen/)) return 'tv-boxes';
  if (spec.packaging === 'crate' || has(text, /crate|\bdie\b|gearbox|housing/)) return 'wooden-crate';
  if (has(text, /machine|spindle|\bcnc\b|lathe|motor|compressor|generator|pump|\bskid\b/)) return 'machine';
  if (has(text, /paint|pail|bucket|chlorine|cleaner|corrosive|detergent|adhesive|resin|lacquer|coating/)) return 'pails';
  if (has(text, /brick|cinder|paver|\bblocks?\b|\btiles?\b|cement/)) return 'bricks';
  if (has(text, /furniture|sofa|chair|table|desk|cabinet|wardrobe|mattress|flat-pack/)) return 'furniture';
  if (spec.temp === 'frozen' || has(text, /frozen|ice cream/)) return 'frozen-cartons';
  if (has(text, /dairy|milk|yog|cheese|butter|cream/)) return 'dairy-crates';
  if (has(text, /produce|fruit|vegetable|apple|banana|orange|tomato|lettuce|salad|berr/)) return 'produce-crates';
  if (has(text, /beverage|drink|water|soda|beer|wine|juice|bottle|cola/)) return 'beverages';
  if (spec.packaging === 'carton') return 'carton';
  if (palletized) return 'pallet-cartons';
  return 'custom';
}
