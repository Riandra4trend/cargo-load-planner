import { stopColor } from '../domain/colors';
import { unitIdOf } from '../domain/geometry';
import { uid } from '../domain/ids';
import { createVehicle, sliderPositions } from '../domain/presets';
import { defaultSettings } from '../domain/settings';
import type { CargoLine, Customer, ItemSpec, Orientation, Placement, Plan, Stop } from '../domain/types';

/** Spec with sensible defaults; only the differences need to be given. */
export function makeSpec(partial: Partial<ItemSpec> & Pick<ItemSpec, 'name' | 'dims' | 'weightKg'>): ItemSpec {
  return {
    sku: '',
    category: '',
    origin: '',
    shape: 'box',
    cogOffset: { x: 0, y: 0, z: 0 },
    packaging: 'custom',
    palletHeight: 0,
    stackable: false,
    maxLoadOnTopKg: 0,
    maxStackLayers: 1,
    fragile: false,
    keepUpright: true,
    rotation: 'yaw',
    temp: 'ambient',
    isFood: false,
    ...partial,
  };
}

const EUR = { l: 1.2, w: 0.8 };
const US = { l: 1.219, w: 1.016 };

interface SeedLine {
  key: string;
  stop: number;
  quantity: number;
  contents?: string;
  spec: ItemSpec;
}

const SEED_CUSTOMERS = ['NordWear', 'Volt Electronics', 'Ironclad Tools', 'FreshFields Market', 'GreenLeaf DC'];
const SEED_STOPS = [
  { name: 'NordWear Outlet, Riverside', distanceKm: 18 },
  { name: 'Volt Electronics, Harbor Park', distanceKm: 31 },
  { name: 'Ironclad Tools, Mill Road', distanceKm: 27 },
  { name: 'FreshFields Market, Oak Street', distanceKm: 36 },
  { name: 'GreenLeaf DC, Northgate', distanceKm: 40 },
];

const SEED_LINES: SeedLine[] = [
  {
    key: 'apparel',
    stop: 1,
    quantity: 4,
    contents: '480 pcs',
    spec: makeSpec({ name: 'Apparel cartons', sku: 'APP-2118', category: 'Apparel', origin: 'Bangladesh', packaging: 'eur-pallet', palletHeight: 0.144, dims: { ...EUR, h: 1.6 }, weightKg: 320, stackable: true, maxLoadOnTopKg: 350, maxStackLayers: 2 }),
  },
  {
    key: 'footwear',
    stop: 1,
    quantity: 2,
    contents: '220 pairs',
    spec: makeSpec({ name: 'Footwear cartons', sku: 'APP-2131', category: 'Footwear', origin: 'Vietnam', packaging: 'us-pallet', palletHeight: 0.14, dims: { ...US, h: 1.5 }, weightKg: 420, stackable: true, maxLoadOnTopKg: 300, maxStackLayers: 2 }),
  },
  {
    key: 'tv',
    stop: 2,
    quantity: 3,
    contents: '12 sets',
    spec: makeSpec({ name: 'Flat-screen TVs 65"', sku: 'ELC-4620', category: 'Electronics', origin: 'Mexico', packaging: 'eur-pallet', palletHeight: 0.144, dims: { ...EUR, h: 1.9 }, weightKg: 300, fragile: true }),
  },
  {
    key: 'batteries',
    stop: 2,
    quantity: 1,
    contents: '64 packs',
    spec: makeSpec({ name: 'Lithium-ion batteries', sku: 'ELC-4688', category: 'Batteries', origin: 'China', packaging: 'eur-pallet', palletHeight: 0.144, dims: { ...EUR, h: 1.1 }, weightKg: 700, hazmat: { unNumber: 'UN3480', hazClass: '9', packingGroup: 'II' } }),
  },
  {
    key: 'glass',
    stop: 2,
    quantity: 1,
    spec: makeSpec({ name: 'Glass display panels, crated', sku: 'ELC-4702', category: 'Glass', origin: 'Germany', packaging: 'crate', dims: { l: 2.4, w: 0.6, h: 1.8 }, weightKg: 520, fragile: true }),
  },
  {
    key: 'die',
    stop: 3,
    quantity: 1,
    spec: makeSpec({ name: 'Press die set, crated', sku: 'IND-3305', category: 'Machinery', origin: 'Germany', packaging: 'crate', dims: { l: 1.2, w: 1.0, h: 0.9 }, weightKg: 1450 }),
  },
  {
    key: 'gearbox',
    stop: 3,
    quantity: 1,
    spec: makeSpec({ name: 'Gearbox housing, crated', sku: 'IND-3317', category: 'Machinery', origin: 'Italy', packaging: 'crate', dims: { l: 1.2, w: 1.0, h: 1.0 }, weightKg: 1150 }),
  },
  {
    key: 'spindle',
    stop: 3,
    quantity: 1,
    spec: makeSpec({ name: 'CNC spindle unit on skid', sku: 'IND-3340', category: 'Machinery', origin: 'Japan', packaging: 'custom', dims: { l: 1.6, w: 1.1, h: 1.4 }, weightKg: 1250, cogOffset: { x: 0.35, y: 0, z: -0.2 }, notes: 'Motor end heavy: COG 0.35 m toward the motor end, low on the skid.' }),
  },
  {
    key: 'profiles',
    stop: 3,
    quantity: 1,
    spec: makeSpec({ name: 'Steel profiles 4 m', sku: 'IND-3362', category: 'Steel', origin: 'Poland', packaging: 'long-goods', dims: { l: 4.0, w: 0.4, h: 0.3 }, weightKg: 420, stackable: true, maxLoadOnTopKg: 200, maxStackLayers: 2, keepUpright: false }),
  },
  {
    key: 'paint',
    stop: 3,
    quantity: 1,
    contents: '48 pails',
    spec: makeSpec({ name: 'Industrial paint', sku: 'CHM-1263', category: 'Chemicals', origin: 'Netherlands', packaging: 'eur-pallet', palletHeight: 0.144, dims: { ...EUR, h: 1.0 }, weightKg: 620, hazmat: { unNumber: 'UN1263', hazClass: '3', packingGroup: 'II' } }),
  },
  {
    key: 'chlorine',
    stop: 3,
    quantity: 1,
    contents: '40 buckets',
    spec: makeSpec({ name: 'Pool chlorine (calcium hypochlorite)', sku: 'CHM-2880', category: 'Chemicals', origin: 'USA', packaging: 'eur-pallet', palletHeight: 0.144, dims: { ...EUR, h: 0.9 }, weightKg: 560, hazmat: { unNumber: 'UN2880', hazClass: '5.1', packingGroup: 'II' } }),
  },
  {
    key: 'dairy',
    stop: 4,
    quantity: 3,
    spec: makeSpec({ name: 'Chilled dairy', sku: 'FRS-1102', category: 'Dairy', origin: 'Denmark', packaging: 'eur-pallet', palletHeight: 0.144, dims: { ...EUR, h: 1.5 }, weightKg: 900, temp: 'chilled', isFood: true }),
  },
  {
    key: 'produce',
    stop: 4,
    quantity: 2,
    spec: makeSpec({ name: 'Fresh produce', sku: 'FRS-1140', category: 'Produce', origin: 'Spain', packaging: 'us-pallet', palletHeight: 0.14, dims: { ...US, h: 1.6 }, weightKg: 750, temp: 'chilled', isFood: true }),
  },
  {
    key: 'fish',
    stop: 5,
    quantity: 3,
    spec: makeSpec({ name: 'Frozen fish', sku: 'FRZ-1201', category: 'Seafood', origin: 'Norway', packaging: 'eur-pallet', palletHeight: 0.144, dims: { ...EUR, h: 1.5 }, weightKg: 950, temp: 'frozen', isFood: true }),
  },
  {
    key: 'meals',
    stop: 5,
    quantity: 1,
    spec: makeSpec({ name: 'Chilled ready meals', sku: 'FRS-1188', category: 'Ready meals', origin: 'France', packaging: 'eur-pallet', palletHeight: 0.144, dims: { ...EUR, h: 1.6 }, weightKg: 640, temp: 'chilled', isFood: true }),
  },
];

/** Two floor lanes across the reefer width: left lane y = 0, right lane y = 1.25. */
const LANE_Y = [0, 1.25];

/**
 * Deliberately imperfect starting plan on the multi-temp reefer: the stop order is mostly right,
 * but the batteries for stop 2 sit at the doors behind stop-1 freight, and the trailer tandem is
 * slid to its rearmost hole, which overloads the drive tandem. Optimise fixes both.
 * [key, unit index, lane, x, orientation]
 */
const SEED_LAYOUT: [string, number, 0 | 1, number, Orientation][] = [
  ['fish', 0, 0, 0.0, 1],
  ['fish', 1, 1, 0.0, 1],
  ['fish', 2, 0, 0.8, 1],
  ['meals', 0, 0, 1.6, 1],
  ['dairy', 0, 1, 1.6, 1],
  ['dairy', 1, 0, 2.4, 1],
  ['dairy', 2, 1, 2.4, 1],
  ['produce', 0, 0, 3.2, 1],
  ['produce', 1, 1, 3.2, 1],
  ['die', 0, 0, 4.4, 1],
  ['gearbox', 0, 1, 4.4, 1],
  ['spindle', 0, 0, 5.4, 0],
  ['paint', 0, 1, 5.4, 1],
  ['profiles', 0, 0, 7.0, 0],
  ['chlorine', 0, 1, 7.2, 1],
  ['tv', 0, 1, 8.0, 1],
  ['tv', 1, 1, 8.8, 1],
  ['tv', 2, 1, 9.6, 1],
  ['apparel', 0, 1, 10.4, 1],
  ['apparel', 1, 1, 11.2, 1],
  ['apparel', 2, 1, 12.0, 1],
  ['footwear', 0, 1, 12.8, 1],
  ['batteries', 0, 1, 13.816, 1],
  ['glass', 0, 0, 11.0, 0],
  ['apparel', 3, 0, 13.4, 1],
  ['footwear', 1, 0, 14.2, 1],
];

export function createSeedPlan(): Plan {
  const customers: Customer[] = SEED_CUSTOMERS.map((name, i) => ({ id: `cust-${i + 1}`, name, color: stopColor(i + 1) }));
  const stops: Stop[] = SEED_STOPS.map((s, i) => ({ id: `stop-${i + 1}`, name: s.name, customerId: customers[i].id, sequence: i + 1, distanceKm: s.distanceKm }));
  const lineIdByKey = new Map<string, string>();
  const lines: CargoLine[] = SEED_LINES.map((l) => {
    const id = `line-${l.key}`;
    lineIdByKey.set(l.key, id);
    return { id, spec: l.spec, quantity: l.quantity, contents: l.contents, stopId: stops[l.stop - 1].id, priority: 'normal' };
  });

  const vehicle = createVehicle('us-reefer-53', 'veh-1');
  vehicle.name = 'Truck 1 · US 53 ft reefer';
  vehicle.zones = [
    { id: 'zone-1', temp: 'frozen', fromX: 0, toX: 1.6 },
    { id: 'zone-2', temp: 'chilled', fromX: 1.6, toX: 4.4 },
    { id: 'zone-3', temp: 'ambient', fromX: 4.4, toX: vehicle.cargo.l },
  ];
  if (vehicle.statics.type === 'artic') {
    const holes = sliderPositions(vehicle);
    vehicle.statics.trailerAxle.x = holes[holes.length - 1];
  }

  const placements: Record<string, Placement> = {};
  for (const [key, index, lane, x, orient] of SEED_LAYOUT) {
    const unitId = unitIdOf(lineIdByKey.get(key)!, index);
    placements[unitId] = { unitId, vehicleId: vehicle.id, pos: { x, y: LANE_Y[lane], z: 0 }, orient };
  }

  const today = new Date();
  return {
    version: 1,
    id: uid('plan'),
    name: 'Route R-14 · mixed delivery',
    meta: {
      date: today.toISOString().slice(0, 10),
      time: '06:30',
      dock: 'Dock 4',
      route: 'R-14',
      distanceKm: SEED_STOPS.reduce((s, x) => s + x.distanceKm, 0),
      driver: '',
      notes: '',
    },
    customers,
    stops,
    lines,
    vehicles: [vehicle],
    placements,
    settings: defaultSettings(),
  };
}
