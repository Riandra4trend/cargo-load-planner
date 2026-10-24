/**
 * Domain model for LoadPlanner 3D: the shared contract between physics, rules,
 * packing, state, scene and UI.
 *
 * Cargo-space coordinates (metres): x runs along the length from the front wall
 * (bulkhead behind the cab) toward the rear doors, y runs across the width from
 * the left wall (driver side, facing forward) to the right wall, z points up
 * from the floor. Masses are kilograms. Everything is stored in SI units; the
 * UI converts for display. Conversion to three.js happens only in scene/coords.ts.
 */

export type Id = string;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Item-local dimensions in metres: l = length, w = width, h = height. */
export interface Dims {
  l: number;
  w: number;
  h: number;
}

export type Shape = 'box' | 'cylinder-upright' | 'cylinder-lying';
export type TempClass = 'ambient' | 'chilled' | 'frozen';
/** Allowed re-orientations: none, around the vertical axis only, or all 6 axis-aligned orientations. */
export type RotationRule = 'none' | 'yaw' | 'any';
export type Priority = 'normal' | 'urgent';
export type PackingGroup = 'I' | 'II' | 'III';
export type PackagingKind =
  | 'eur-pallet'
  | 'eur-half'
  | 'industrial-pallet'
  | 'us-pallet'
  | 'carton'
  | 'crate'
  | 'drum'
  | 'ibc'
  | 'jerrycan'
  | 'long-goods'
  /** A tanker compartment fill: no packaging, carried in a tank compartment instead of on the floor. */
  | 'bulk-liquid'
  | 'custom';

export interface Hazmat {
  /** e.g. "UN3480" */
  unNumber: string;
  /** Class or division, e.g. "9", "2.1", "3", "5.1", "8". */
  hazClass: string;
  packingGroup?: PackingGroup;
  netQtyKg?: number;
}

/**
 * Liquid contents of a unit. Packaged liquids (drum, IBC, jerrycan) weigh volume × density plus the
 * container; bulk liquids ('bulk-liquid' packaging) are one tanker compartment fill weighing volume × density.
 * ItemSpec.weightKg stays the authoritative gross weight and is derived from these values by the editor.
 */
export interface LiquidContents {
  /** Library id from domain/liquids.ts, or 'custom'. */
  liquidId: string;
  /** Display name, e.g. "Diesel (solar)". */
  name: string;
  /** Density at 15 °C, kg per litre. */
  densityKgPerL: number;
  /** Liquid per unit, litres. */
  volumeL: number;
  /** Packaged liquids in a non-preset container ("Other container"): its brim capacity, litres. Preset containers use PACKAGING_PRESETS[packaging].capacityL. */
  containerCapacityL?: number;
}

/** Physical and handling definition of one cargo unit (pallet, crate, drum, ...). */
export interface ItemSpec {
  name: string;
  sku: string;
  category: string;
  origin: string;
  /** Optional hex colour override used by the "customer"/"custom" colour modes. */
  color?: string;
  notes?: string;
  shape: Shape;
  /** Outer dimensions including the pallet, metres. */
  dims: Dims;
  /** Gross weight of one unit including the pallet, kg. */
  weightKg: number;
  /** Centre-of-gravity offset from the geometric centre in item-local axes (x along l, y along w, z along h), metres. */
  cogOffset: Vec3;
  packaging: PackagingKind;
  /** Pallet height in metres (0 = not palletized). Already included in dims.h. */
  palletHeight: number;
  /** Whether other units may be placed on top of this one. */
  stackable: boolean;
  /** Maximum total weight that may rest on top of this unit, kg. */
  maxLoadOnTopKg: number;
  /** Maximum number of layers (counted from the floor) of any stack containing this unit. 1 = floor only, nothing on top. */
  maxStackLayers: number;
  /** Fragile units never carry anything on top. */
  fragile: boolean;
  /** The h axis must stay vertical. */
  keepUpright: boolean;
  rotation: RotationRule;
  temp: TempClass;
  /** Foodstuff / animal feed: kept away from toxic and infectious hazmat (classes 6.1 and 6.2). */
  isFood: boolean;
  hazmat?: Hazmat;
  /** Present when the unit is (or contains) a liquid. */
  liquid?: LiquidContents;
}

export interface ItemTemplate {
  id: Id;
  spec: ItemSpec;
  contents?: string;
  builtIn: boolean;
}

/** A row in the item table: `quantity` identical physical units of one spec, delivered to one stop. */
export interface CargoLine {
  id: Id;
  spec: ItemSpec;
  /** Number of identical physical units (>= 1). */
  quantity: number;
  /** Free-text contents, e.g. "520 units". */
  contents?: string;
  stopId: Id;
  priority: Priority;
  /** Optional delivery window, "HH:MM". */
  timeWindow?: { from: string; to: string };
  /** Epoch ms when added through an urgent order; used to highlight new rows. */
  addedAt?: number;
}

export interface Customer {
  id: Id;
  name: string;
  /** Hex colour used for this customer's stop everywhere (3D, table, legend, charts). */
  color: string;
}

export interface Stop {
  id: Id;
  name: string;
  customerId: Id;
  /** 1-based delivery order; kept contiguous (1..n) by the store. */
  sequence: number;
  address?: string;
  /** Driving distance from the previous stop (from the depot for stop 1), km. Missing = 0. */
  distanceKm?: number;
}

/** One physical unit derived from a line. id = `${lineId}#${index}` (see geometry.unitIdOf). */
export interface CargoUnit {
  id: Id;
  lineId: Id;
  index: number;
  spec: ItemSpec;
  stopId: Id;
  /** Delivery order of the unit's stop (1-based). */
  stopSeq: number;
  priority: Priority;
}

/** Index into geometry.ORIENTATION_AXES (6 axis-aligned orientations). */
export type Orientation = 0 | 1 | 2 | 3 | 4 | 5;

export interface Placement {
  unitId: Id;
  vehicleId: Id;
  /** Minimum corner of the unit's bounding box in cargo coordinates. */
  pos: Vec3;
  orient: Orientation;
  /** Pinned units are never moved by the optimiser. */
  pinned?: boolean;
  /** Bulk liquids only: the tanker compartment holding this fill (pos/orient are then unused). */
  compartmentId?: Id;
}

export type VehicleKind = 'van' | 'rigid' | 'semi' | 'container' | 'flatbed' | 'tanker';
export type AccessSide = 'rear' | 'side' | 'top';
export type Region = 'EU' | 'US' | 'custom';

export interface AxleGroup {
  id: Id;
  label: string;
  /** Group centre. Rigid vehicles and trailers: metres from the cargo front wall (negative = ahead of it). Tractor: metres from the steer axle. */
  x: number;
  /** Number of axles in the group: 1 single, 2 tandem, 3 tridem. */
  count: number;
  /** Distance between the first and last axle of the group, metres (0 for a single axle). */
  spread: number;
  /** Unladen load on this group, kg (rigid: vehicle tare share; tractor groups: tractor tare share; trailer group: unused, see ArticStatics.trailerTareKg). */
  tareKg: number;
  maxKg: number;
  /** Minimum fraction of the gross weight this group must carry (steering / traction). */
  minShare?: number;
  steer?: boolean;
  driven?: boolean;
}

/** Rigid vehicle (van, box truck): exactly two axle groups, statically determinate. */
export interface RigidStatics {
  type: 'rigid';
  front: AxleGroup;
  rear: AxleGroup;
}

/** Tractor + semi-trailer (or container chassis): two-stage statics through the kingpin. */
export interface ArticStatics {
  type: 'artic';
  /** Kingpin position, metres from the trailer cargo front wall. */
  kingpinX: number;
  /** Trailer axle group; x = group centre from the cargo front wall (moves with the slider). */
  trailerAxle: AxleGroup;
  trailerTareKg: number;
  /** Trailer tare centre of gravity, metres from the cargo front wall. */
  trailerTareX: number;
  /** Sliding tandem: allowed trailerAxle.x positions are minX + i * step for i in [0, holes). */
  slider?: { minX: number; step: number; holes: number };
  /** Tractor groups, x measured from the steer axle (steer.x = 0). */
  steer: AxleGroup;
  drive: AxleGroup;
  /** Fifth-wheel (kingpin coupling) position, metres from the steer axle. */
  fifthWheelX: number;
}

export interface TempZone {
  id: Id;
  temp: TempClass;
  /** Zone extent along x, metres from the cargo front wall. Zones are contiguous and cover the cargo length. */
  fromX: number;
  toX: number;
}

export interface TankCompartment {
  id: Id;
  /** "C1", "C2", ... (front to rear). */
  label: string;
  /** Extent along the tank, metres from the cargo front wall. */
  fromX: number;
  toX: number;
  /** Brim capacity, litres. */
  capacityL: number;
}

/** Tank of a tanker vehicle: compartments along the barrel (cargo dims = barrel length × width × height). */
export interface TankSpec {
  compartments: TankCompartment[];
  /** Surge baffles inside the compartments make partial fills safe. */
  baffled: boolean;
  /** Food-grade (stainless) tank: may carry foodstuffs such as milk, edible oil or drinking water. */
  foodGrade: boolean;
  insulated: boolean;
  /** Pressure vessel for liquefied gases such as LPG; it carries only liquids that need one. */
  pressurised: boolean;
}

export interface Vehicle {
  id: Id;
  /** Preset this vehicle was created from, or 'custom'. */
  presetId: string;
  name: string;
  region: Region;
  kind: VehicleKind;
  /** Internal cargo space (flatbed: deck length x width x height cap). */
  cargo: Dims;
  /** Door aperture (width x height) used to check that units fit through it. */
  door: { w: number; h: number };
  access: AccessSide[];
  walls: boolean;
  tempControlled: boolean;
  /** Movable bulkheads: the optimiser sizes the temperature zones. */
  multiTemp: boolean;
  zones: TempZone[];
  /** Extra clearance below the ceiling for reefer airflow, metres. */
  airflowTopGap: number;
  /** GVW (rigid) or GCW (articulated), kg. */
  grossLimitKg: number;
  /** Rated payload, kg. */
  payloadKg: number;
  /** Concentrated-load floor rating, kg per running metre. */
  floorKgPerM: number;
  /** Maximum cargo centre-of-gravity height above the floor, metres. */
  maxCogHeight: number;
  /** Floor height above ground, metres (rendering and COG-above-ground readout). */
  deckHeight: number;
  /** Length of one numbered floor bay (B.01, B.02, ...), metres. */
  bayLength: number;
  /** Apply the US Federal Bridge Formula to every group of consecutive axles. */
  bridgeFormula: boolean;
  /** Maximum left/right cargo imbalance as a fraction (0.1 = 10 %). */
  lateralMaxImbalance: number;
  fuel: FuelProfile;
  statics: RigidStatics | ArticStatics;
  /** Tanker vehicles only. */
  tank?: TankSpec;
}

/**
 * Diesel use of a vehicle. Driving consumption is linear in the cargo weight between the empty and the
 * full (rated payload) figures and extrapolates above the payload.
 */
export interface FuelProfile {
  /** Driving consumption with no cargo, litres per 100 km. */
  emptyLPer100km: number;
  /** Driving consumption at the rated payload, litres per 100 km. */
  fullLPer100km: number;
  /** Engine idling while stopped at a delivery, litres per hour. */
  idleLPerHour: number;
  /** Refrigeration unit while chilled or frozen cargo is aboard, litres per hour (0 = no reefer). */
  reeferLPerHour: number;
  /** Fuel tank capacity, litres. */
  tankL: number;
}

export type UnitSystem = 'metric' | 'imperial';
export type ColorMode = 'stop' | 'customer' | 'temperature' | 'hazmat' | 'weight';
/** 'ok' = may share a vehicle, 'separate' = keep >= hazmatSeparationM apart, 'never' = not in the same vehicle. */
export type HazmatRule = 'ok' | 'separate' | 'never';

export interface PlanSettings {
  units: UnitSystem;
  /** Minimum supported fraction of a stacked unit's base. */
  supportRatio: number;
  /** Minimum gap below the ceiling, metres (reefers add airflowTopGap). */
  ceilingClearance: number;
  /** Overlap tolerance, metres. */
  overlapTolerance: number;
  /** Axle utilisation from which the status becomes NEAR LIMIT. */
  nearLimit: number;
  forkliftCapacityKg: number;
  /** Drag snapping grid, metres. */
  snapGrid: number;
  hazmatSeparationM: number;
  /** Required distance between class 6.1/6.2 hazmat and foodstuffs, metres. */
  foodSeparationM: number;
  /** Symmetric compatibility matrix keyed by hazmat class (e.g. "3" -> "5.1" -> 'separate'). Missing pairs mean 'ok'. */
  hazmatMatrix: Record<string, Record<string, HazmatRule>>;
  tempRanges: Record<TempClass, { min: number; max: number }>;
  optimiserTimeMs: number;
  seed: number;
  /** Diesel price per litre in `currency`. */
  fuelPricePerL: number;
  /** ISO 4217 currency code for fuel cost, e.g. "USD", "EUR", "IDR". */
  currency: string;
  /** Tank-to-wheel CO2 per litre of diesel, kg. */
  co2KgPerL: number;
  /** Average driving speed between stops, km/h (drives reefer running time). */
  avgSpeedKmh: number;
  /** Time spent at each delivery stop, minutes (the reefer keeps running). */
  stopMinutes: number;
  /** Engine idling at each delivery stop, minutes. */
  idleMinutesPerStop: number;
}

export interface PlanMeta {
  /** ISO date, YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  dock: string;
  route: string;
  /** Empty drive from the last stop back to the depot, km (0 = not counted). */
  returnKm: number;
  driver: string;
  notes: string;
}

export interface Plan {
  version: 1;
  id: Id;
  name: string;
  meta: PlanMeta;
  customers: Customer[];
  stops: Stop[];
  lines: CargoLine[];
  vehicles: Vehicle[];
  /** Keyed by unit id; a unit without a placement is unplaced. */
  placements: Record<Id, Placement>;
  settings: PlanSettings;
}

// ---------------------------------------------------------------------------
// Evaluation results (physics + rules)
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning' | 'info';

export type ViolationKind =
  // hard constraints
  | 'bounds'
  | 'door'
  | 'overlap'
  | 'ceiling'
  | 'support'
  | 'stacking'
  | 'fragile'
  | 'rotation'
  | 'temperature'
  | 'hazmat'
  | 'tank'
  // soft constraints
  | 'axle-max'
  | 'axle-min'
  | 'gross'
  | 'payload'
  | 'bridge'
  | 'lateral'
  | 'cog-height'
  | 'floor-load'
  | 'lifo'
  | 'forklift'
  | 'surge';

export type FixAction =
  | { type: 'move'; unitId: Id; pos: Vec3; orient?: Orientation }
  | { type: 'slider'; vehicleId: Id; x: number }
  | { type: 'compartment'; unitId: Id; vehicleId: Id; compartmentId: Id };

export interface Violation {
  /** Stable key, unique within one evaluation. */
  id: string;
  kind: ViolationKind;
  severity: Severity;
  /** Hard constraints are never broken by the optimiser; manual moves breaking them are rejected. */
  hard: boolean;
  message: string;
  vehicleId: Id;
  unitIds: Id[];
  /** 0 = at departure, k = after stop k. */
  stage?: number;
  fix?: { label: string; action: FixAction };
}

export type AxleStatus = 'legal' | 'near' | 'over' | 'under';

export interface AxleLoad {
  id: Id;
  label: string;
  kg: number;
  maxKg: number;
  /** minShare * gross, 0 when the group has no minimum. */
  minKg: number;
  /** kg / maxKg */
  ratio: number;
  status: AxleStatus;
}

export interface AxleState {
  axles: AxleLoad[];
  grossKg: number;
  cargoKg: number;
  /** Articulated only: load transferred through the kingpin. */
  kingpinKg?: number;
  /** Cargo centre of gravity (cargo coordinates), null when empty. */
  cog: Vec3 | null;
  /** Worst status over all groups and the gross limit (over > under > near > legal). */
  status: AxleStatus;
  grossOver: boolean;
}

export interface StageResult {
  /** 0 = departure, k = after stop k. */
  stage: number;
  label: string;
  /** Units still aboard at this stage. */
  unitIds: Id[];
  axle: AxleState;
}

export interface CurvePoint {
  /** Cargo COG position from the front wall, metres. */
  x: number;
  /** Maximum legal payload with the COG at x, kg. */
  maxKg: number;
  limitedBy: string;
}

export interface BridgeCheck {
  label: string;
  /** Number of axles in the checked group. */
  n: number;
  lengthFt: number;
  allowedLb: number;
  actualLb: number;
  ok: boolean;
}

export interface BayInfo {
  index: number;
  /** "B.01" */
  label: string;
  fromX: number;
  toX: number;
  kg: number;
  /** Occupied volume fraction of the bay (0..1). */
  fill: number;
}

export type UnitStatus = 'planned' | 'loaded' | 'unplaced' | 'check' | 'urgent';
