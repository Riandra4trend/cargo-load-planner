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
  /** Loose bulk material: one fill of a tank compartment or tipper body instead of a unit on the floor. */
  | 'bulk'
  | 'custom';

export interface Hazmat {
  /** e.g. "UN3480" */
  unNumber: string;
  /** Class or division, e.g. "9", "2.1", "3", "5.1", "8". */
  hazClass: string;
  packingGroup?: PackingGroup;
  netQtyKg?: number;
}

export type MaterialState = 'liquid' | 'solid';

/**
 * Material measured by volume. Liquids travel packaged (drum, IBC, jerrycan: volume × density plus the
 * container) or loose in a tanker compartment; dry bulk (sand, gravel, coal, grain...) rides loose in a
 * tipper body. A loose fill ('bulk' packaging) weighs volume × density. ItemSpec.weightKg stays the
 * authoritative gross weight and is derived from these values by the editor.
 */
export interface MaterialContents {
  /** Library id from domain/materials.ts, or 'custom'. */
  materialId: string;
  /** Display name, e.g. "Diesel (solar)" or "Sand (dry)". */
  name: string;
  state: MaterialState;
  /** Density (loose bulk density for solids), kg per litre = t/m³. */
  densityKgPerL: number;
  /** Volume per unit, litres (1 m³ = 1,000 L). */
  volumeL: number;
  /** Packaged material in a non-preset container ("Other container"): its brim capacity, litres. Preset containers use PACKAGING_PRESETS[packaging].capacityL. */
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
  /** Present when the unit is (or contains) a material measured by volume: a liquid or dry bulk. */
  material?: MaterialContents;
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
  /** Bulk fills only: the compartment holding this fill, a tank compartment or tipper body (pos/orient are then unused). */
  compartmentId?: Id;
}

export type VehicleKind = 'van' | 'rigid' | 'semi' | 'container' | 'flatbed' | 'tanker' | 'tipper';
export type AccessSide = 'rear' | 'side' | 'top';
/**
 * Body of van, rigid and semi vehicles: closed box (default), curtainsider, wingbox (both sides lift open)
 * or dropside (open bed with low drop sides, e.g. a pick-up).
 */
export type BodyStyle = 'box' | 'curtain' | 'wingbox' | 'dropside';
/** Preset origin: Europe, North America, Indonesia, international (ISO containers) or user-defined. */
export type Region = 'EU' | 'US' | 'ID' | 'INTL' | 'custom';

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

export interface Compartment {
  id: Id;
  /** "C1", "C2", ... front to rear ("Body" for a tipper). */
  label: string;
  /** Extent along the cargo space, metres from the front wall. */
  fromX: number;
  toX: number;
  /** Litres: brim capacity of a tank compartment, struck (level-full) capacity of a tipper body. */
  capacityL: number;
}

export type BulkKind = 'tank' | 'tipper';

/**
 * Loose-bulk cargo space: a tanker's tank (liquids, compartments along the barrel) or a tipper's dump body
 * (dry bulk, one open compartment). The vehicle's cargo dims are the barrel or body inside dimensions.
 */
export interface BulkSpec {
  kind: BulkKind;
  compartments: Compartment[];
  /** Tanks: surge baffles inside the compartments make partial fills safe. */
  baffled: boolean;
  /** Tanks: food-grade (stainless) tank that may carry foodstuffs such as milk, edible oil or drinking water. */
  foodGrade: boolean;
  /** Tanks: insulated, for chilled liquids. */
  insulated: boolean;
  /** Tanks: pressure vessel for liquefied gases such as LPG; it carries only materials that need one. */
  pressurised: boolean;
}

export interface Vehicle {
  id: Id;
  /** Preset this vehicle was created from, or 'custom'. */
  presetId: string;
  name: string;
  region: Region;
  kind: VehicleKind;
  /** Van, rigid and semi only; absent means a closed box. */
  body?: BodyStyle;
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
  /** Tankers and tippers only. */
  bulk?: BulkSpec;
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
  | 'bulk'
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
