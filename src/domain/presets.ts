import { uid } from './ids';
import { lbToKg } from './units';
import type { AxleGroup, FuelProfile, Compartment, TempZone, Vehicle } from './types';

/**
 * Vehicle presets. All values are approximate, typical figures for illustration and fully
 * editable in the vehicle editor. Tare axle loads and axle positions are chosen so every preset
 * can carry its rated payload (or its road-limited maximum) legally inside some COG window;
 * physics tests assert this.
 */
export interface VehiclePresetInfo {
  id: string;
  name: string;
  region: Vehicle['region'];
  summary: string;
}

const US_STEER_MAX = lbToKg(12_000);
const US_TANDEM_MAX = lbToKg(34_000);
const US_GROSS_MAX = lbToKg(80_000);

const fullZone = (length: number, temp: TempZone['temp'] = 'ambient'): TempZone[] => [
  { id: 'zone-1', temp, fromX: 0, toX: length },
];

/** Compartments along a barrel of `length` metres, each as long as its share of the total capacity. */
export function compartments(length: number, capacitiesL: number[]): Compartment[] {
  const total = capacitiesL.reduce((sum, c) => sum + c, 0);
  let x = 0;
  return capacitiesL.map((capacityL, i) => {
    const fromX = x;
    x = i === capacitiesL.length - 1 ? length : Math.round((x + (length * capacityL) / total) * 1000) / 1000;
    return { id: `c${i + 1}`, label: `C${i + 1}`, fromX, toX: x, capacityL };
  });
}

const euTractor = (): { steer: AxleGroup; drive: AxleGroup; fifthWheelX: number } => ({
  steer: { id: 'steer', label: 'Steer axle', x: 0, count: 1, spread: 0, tareKg: 4700, maxKg: 7500, minShare: 0.1, steer: true },
  drive: { id: 'drive', label: 'Drive axle', x: 3.6, count: 1, spread: 0, tareKg: 2700, maxKg: 11_500, minShare: 0.25, driven: true },
  fifthWheelX: 2.9,
});

/** Fields shared by every tanker: top access only, no floor bays or doors in use, ambient (insulation is on the tank). */
const tankerBase = (l: number, w: number, h: number) => ({
  kind: 'tanker' as const,
  cargo: { l, w, h },
  door: { w, h },
  access: ['top' as const],
  walls: true,
  tempControlled: false,
  multiTemp: false,
  zones: fullZone(l),
  airflowTopGap: 0,
  floorKgPerM: 10_000,
  maxCogHeight: h,
  bridgeFormula: false,
  lateralMaxImbalance: 0.1,
});

/** Fields shared by tippers: one open body (struck capacity = inside l × w × h) tipped over the tailgate. */
const tipperBase = (l: number, w: number, h: number) => ({
  kind: 'tipper' as const,
  cargo: { l, w, h },
  door: { w, h },
  access: ['top' as const, 'rear' as const],
  walls: true,
  tempControlled: false,
  multiTemp: false,
  zones: fullZone(l),
  airflowTopGap: 0,
  floorKgPerM: 10_000,
  maxCogHeight: h,
  bridgeFormula: false,
  lateralMaxImbalance: 0.1,
  bulk: {
    kind: 'tipper' as const,
    compartments: [{ id: 'body', label: 'Body', fromX: 0, toX: l, capacityL: Math.round(l * w * h * 1000) }],
    baffled: false,
    foodGrade: false,
    insulated: false,
    pressurised: false,
  },
});

/** Fields shared by truck bodies loaded through rear doors: ambient, single zone, no Bridge Formula. */
const truckBase = (l: number, w: number, h: number, doorW: number, doorH: number) => ({
  cargo: { l, w, h },
  door: { w: doorW, h: doorH },
  access: ['rear' as const],
  walls: true,
  tempControlled: false,
  multiTemp: false,
  zones: fullZone(l),
  airflowTopGap: 0,
  bridgeFormula: false,
  lateralMaxImbalance: 0.1,
});

/** ISO container on a skeletal chassis behind a 4×2 tractor; the container's tare rides with the chassis. */
const isoChassis = (axleX: number, count: 2 | 3, trailerTareKg: number, trailerTareX: number) => ({
  type: 'artic' as const,
  kingpinX: 1.0,
  trailerAxle: { id: 'trailer', label: count === 2 ? 'Chassis tandem' : 'Chassis tridem', x: axleX, count, spread: count === 2 ? 1.31 : 2.62, tareKg: 0, maxKg: count === 2 ? 18_000 : 24_000 },
  trailerTareKg,
  trailerTareX,
  ...euTractor(),
});

const usTractor = (): { steer: AxleGroup; drive: AxleGroup; fifthWheelX: number } => ({
  steer: { id: 'steer', label: 'Steer axle', x: 0, count: 1, spread: 0, tareKg: 4500, maxKg: US_STEER_MAX, minShare: 0.1, steer: true },
  drive: { id: 'drive', label: 'Drive tandem', x: 4.9, count: 2, spread: 1.32, tareKg: 3800, maxKg: US_TANDEM_MAX, minShare: 0.25, driven: true },
  fifthWheelX: 4.6,
});

const usTrailerTandem = (x: number): AxleGroup => ({
  id: 'trailer',
  label: 'Trailer tandem',
  x,
  count: 2,
  spread: 1.245,
  tareKg: 0,
  maxKg: US_TANDEM_MAX,
});

type PresetBody = Omit<Vehicle, 'id'>;

const PRESETS: Record<string, () => PresetBody> = {
  'eu-van-35': () => ({
    presetId: 'eu-van-35',
    name: 'EU van 3.5 t',
    region: 'EU',
    kind: 'van',
    cargo: { l: 4.3, w: 1.75, h: 1.9 },
    door: { w: 1.56, h: 1.84 },
    access: ['rear', 'side'],
    walls: true,
    tempControlled: false,
    multiTemp: false,
    zones: fullZone(4.3),
    airflowTopGap: 0,
    grossLimitKg: 3500,
    payloadKg: 1200,
    floorKgPerM: 700,
    maxCogHeight: 1.1,
    deckHeight: 0.62,
    bayLength: 0.8,
    bridgeFormula: false,
    lateralMaxImbalance: 0.1,
    fuel: { emptyLPer100km: 8.5, fullLPer100km: 10.5, idleLPerHour: 0.8, reeferLPerHour: 0, tankL: 75 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -1.0, count: 1, spread: 0, tareKg: 1250, maxKg: 1800, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear axle', x: 3.325, count: 1, spread: 0, tareKg: 1050, maxKg: 2400, minShare: 0.25, driven: true },
    },
  }),
  'eu-rigid-18': () => ({
    presetId: 'eu-rigid-18',
    name: 'EU box truck 18 t',
    region: 'EU',
    kind: 'rigid',
    cargo: { l: 7.3, w: 2.45, h: 2.5 },
    door: { w: 2.4, h: 2.4 },
    access: ['rear'],
    walls: true,
    tempControlled: false,
    multiTemp: false,
    zones: fullZone(7.3),
    airflowTopGap: 0,
    grossLimitKg: 18_000,
    payloadKg: 9500,
    floorKgPerM: 2500,
    maxCogHeight: 1.5,
    deckHeight: 1.1,
    bayLength: 1.2,
    bridgeFormula: false,
    lateralMaxImbalance: 0.1,
    fuel: { emptyLPer100km: 19, fullLPer100km: 25, idleLPerHour: 1.8, reeferLPerHour: 0, tankL: 200 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -1.3, count: 1, spread: 0, tareKg: 4800, maxKg: 7500, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear axle', x: 4.2, count: 1, spread: 0, tareKg: 3700, maxKg: 11_500, minShare: 0.25, driven: true },
    },
  }),
  'eu-curtainsider-136': () => ({
    presetId: 'eu-curtainsider-136',
    name: 'EU 13.6 m curtainsider',
    region: 'EU',
    kind: 'semi',
    body: 'curtain',
    cargo: { l: 13.6, w: 2.48, h: 2.7 },
    door: { w: 2.48, h: 2.65 },
    access: ['rear', 'side'],
    walls: true,
    tempControlled: false,
    multiTemp: false,
    zones: fullZone(13.6),
    airflowTopGap: 0,
    grossLimitKg: 40_000,
    payloadKg: 25_700,
    floorKgPerM: 3300,
    maxCogHeight: 1.6,
    deckHeight: 1.15,
    bayLength: 1.2,
    bridgeFormula: false,
    lateralMaxImbalance: 0.1,
    fuel: { emptyLPer100km: 23, fullLPer100km: 32, idleLPerHour: 2.5, reeferLPerHour: 0, tankL: 600 },
    statics: {
      type: 'artic',
      kingpinX: 1.55,
      trailerAxle: { id: 'trailer', label: 'Trailer tridem', x: 9.6, count: 3, spread: 2.62, tareKg: 0, maxKg: 24_000 },
      trailerTareKg: 6900,
      trailerTareX: 7.5,
      steer: { id: 'steer', label: 'Steer axle', x: 0, count: 1, spread: 0, tareKg: 4700, maxKg: 7500, minShare: 0.1, steer: true },
      drive: { id: 'drive', label: 'Drive axle', x: 3.6, count: 1, spread: 0, tareKg: 2700, maxKg: 11_500, minShare: 0.25, driven: true },
      fifthWheelX: 2.9,
    },
  }),
  'us-dry-van-53': () => ({
    presetId: 'us-dry-van-53',
    name: 'US 53 ft dry van',
    region: 'US',
    kind: 'semi',
    cargo: { l: 16.0, w: 2.54, h: 2.74 },
    door: { w: 2.49, h: 2.67 },
    access: ['rear'],
    walls: true,
    tempControlled: false,
    multiTemp: false,
    zones: fullZone(16.0),
    airflowTopGap: 0,
    grossLimitKg: US_GROSS_MAX,
    payloadKg: lbToKg(45_000),
    floorKgPerM: 5000,
    maxCogHeight: 1.6,
    deckHeight: 1.27,
    bayLength: 1.22,
    bridgeFormula: true,
    lateralMaxImbalance: 0.1,
    fuel: { emptyLPer100km: 27, fullLPer100km: 37, idleLPerHour: 3.0, reeferLPerHour: 0, tankL: 900 },
    statics: {
      type: 'artic',
      kingpinX: 0.9,
      trailerAxle: usTrailerTandem(10.6 + 12 * 0.1524),
      trailerTareKg: 6600,
      trailerTareX: 8.5,
      slider: { minX: 10.6, step: 0.1524, holes: 27 },
      ...usTractor(),
    },
  }),
  'us-reefer-53': () => ({
    presetId: 'us-reefer-53',
    name: 'US 53 ft reefer (multi-temp)',
    region: 'US',
    kind: 'semi',
    cargo: { l: 15.7, w: 2.49, h: 2.6 },
    door: { w: 2.44, h: 2.54 },
    access: ['rear'],
    walls: true,
    tempControlled: true,
    multiTemp: true,
    zones: [
      { id: 'zone-1', temp: 'frozen', fromX: 0, toX: 3.0 },
      { id: 'zone-2', temp: 'chilled', fromX: 3.0, toX: 8.0 },
      { id: 'zone-3', temp: 'ambient', fromX: 8.0, toX: 15.7 },
    ],
    airflowTopGap: 0.2,
    grossLimitKg: US_GROSS_MAX,
    payloadKg: 20_000,
    floorKgPerM: 5000,
    maxCogHeight: 1.5,
    deckHeight: 1.3,
    bayLength: 1.22,
    bridgeFormula: true,
    lateralMaxImbalance: 0.1,
    fuel: { emptyLPer100km: 28, fullLPer100km: 38, idleLPerHour: 3.0, reeferLPerHour: 3.4, tankL: 900 },
    statics: {
      type: 'artic',
      kingpinX: 0.9,
      trailerAxle: usTrailerTandem(10.4 + 12 * 0.1524),
      trailerTareKg: 7000,
      trailerTareX: 7.0,
      slider: { minX: 10.4, step: 0.1524, holes: 26 },
      ...usTractor(),
    },
  }),
  'container-40hc': () => ({
    presetId: 'container-40hc',
    name: 'US 40 ft high-cube container',
    region: 'US',
    kind: 'container',
    cargo: { l: 12.03, w: 2.35, h: 2.69 },
    door: { w: 2.34, h: 2.58 },
    access: ['rear'],
    walls: true,
    tempControlled: false,
    multiTemp: false,
    zones: fullZone(12.03),
    airflowTopGap: 0,
    grossLimitKg: US_GROSS_MAX,
    payloadKg: 26_580,
    floorKgPerM: 3000,
    maxCogHeight: 1.5,
    deckHeight: 1.4,
    bayLength: 1.2,
    bridgeFormula: true,
    lateralMaxImbalance: 0.1,
    fuel: { emptyLPer100km: 27, fullLPer100km: 37, idleLPerHour: 3.0, reeferLPerHour: 0, tankL: 900 },
    statics: {
      type: 'artic',
      kingpinX: 0.9,
      trailerAxle: { ...usTrailerTandem(10.6), label: 'Chassis tandem' },
      trailerTareKg: 6800,
      trailerTareX: 6.5,
      ...usTractor(),
    },
  }),
  'us-flatbed-48': () => ({
    presetId: 'us-flatbed-48',
    name: 'US 48 ft flatbed',
    region: 'US',
    kind: 'flatbed',
    cargo: { l: 14.63, w: 2.59, h: 2.59 },
    door: { w: 2.59, h: 2.59 },
    access: ['rear', 'side', 'top'],
    walls: false,
    tempControlled: false,
    multiTemp: false,
    zones: fullZone(14.63),
    airflowTopGap: 0,
    grossLimitKg: US_GROSS_MAX,
    payloadKg: 21_500,
    floorKgPerM: 5000,
    maxCogHeight: 1.4,
    deckHeight: 1.52,
    bayLength: 1.22,
    bridgeFormula: true,
    lateralMaxImbalance: 0.1,
    fuel: { emptyLPer100km: 26, fullLPer100km: 37, idleLPerHour: 3.0, reeferLPerHour: 0, tankL: 900 },
    statics: {
      type: 'artic',
      kingpinX: 0.9,
      trailerAxle: usTrailerTandem(12.6),
      trailerTareKg: 4500,
      trailerTareX: 7.0,
      ...usTractor(),
    },
  }),
  'tanker-rigid-16k': () => ({
    presetId: 'tanker-rigid-16k',
    name: 'Fuel tanker 16,000 L (rigid 6×4)',
    region: 'EU',
    ...tankerBase(6.2, 2.3, 1.6),
    grossLimitKg: 26_000,
    payloadKg: 16_000,
    deckHeight: 1.3,
    bayLength: 1.55,
    fuel: { emptyLPer100km: 26, fullLPer100km: 34, idleLPerHour: 2.2, reeferLPerHour: 0, tankL: 300 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -2.0, count: 1, spread: 0, tareKg: 5000, maxKg: 8000, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear tandem', x: 4.0, count: 2, spread: 1.35, tareKg: 5000, maxKg: 19_000, minShare: 0.25, driven: true },
    },
    bulk: { kind: 'tank', compartments: compartments(6.2, [4000, 4000, 4000, 4000]), baffled: false, foodGrade: false, insulated: false, pressurised: false },
  }),
  'tanker-semi-32k': () => ({
    presetId: 'tanker-semi-32k',
    name: 'Fuel tanker 32,000 L (semi-trailer)',
    region: 'EU',
    ...tankerBase(11.5, 2.5, 1.85),
    grossLimitKg: 40_000,
    payloadKg: 25_100,
    deckHeight: 1.25,
    bayLength: 2.3,
    fuel: { emptyLPer100km: 24, fullLPer100km: 33, idleLPerHour: 2.5, reeferLPerHour: 0, tankL: 600 },
    statics: {
      type: 'artic',
      kingpinX: 1.0,
      trailerAxle: { id: 'trailer', label: 'Trailer tridem', x: 8.2, count: 3, spread: 2.62, tareKg: 0, maxKg: 24_000 },
      trailerTareKg: 7500,
      trailerTareX: 6.0,
      ...euTractor(),
    },
    bulk: { kind: 'tank', compartments: compartments(11.5, [8000, 6000, 6000, 6000, 6000]), baffled: false, foodGrade: false, insulated: false, pressurised: false },
  }),
  'tanker-water-8k': () => ({
    presetId: 'tanker-water-8k',
    name: 'Water tanker 8,000 L (rigid 4×2)',
    region: 'EU',
    ...tankerBase(4.2, 2.2, 1.4),
    grossLimitKg: 15_000,
    payloadKg: 9000,
    deckHeight: 1.2,
    bayLength: 1.4,
    fuel: { emptyLPer100km: 16, fullLPer100km: 21, idleLPerHour: 1.5, reeferLPerHour: 0, tankL: 150 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -1.4, count: 1, spread: 0, tareKg: 3300, maxKg: 6000, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear axle', x: 3.1, count: 1, spread: 0, tareKg: 2700, maxKg: 10_000, minShare: 0.25, driven: true },
    },
    bulk: { kind: 'tank', compartments: compartments(4.2, [8000]), baffled: true, foodGrade: true, insulated: false, pressurised: false },
  }),
  'tanker-food-24k': () => ({
    presetId: 'tanker-food-24k',
    name: 'Food-grade tanker 24,000 L (semi, insulated)',
    region: 'EU',
    ...tankerBase(10.0, 2.45, 1.8),
    grossLimitKg: 40_000,
    payloadKg: 24_600,
    deckHeight: 1.3,
    bayLength: 3.333,
    fuel: { emptyLPer100km: 25, fullLPer100km: 34, idleLPerHour: 2.5, reeferLPerHour: 0, tankL: 600 },
    statics: {
      type: 'artic',
      kingpinX: 1.0,
      trailerAxle: { id: 'trailer', label: 'Trailer tridem', x: 7.0, count: 3, spread: 2.62, tareKg: 0, maxKg: 24_000 },
      trailerTareKg: 8000,
      trailerTareX: 5.5,
      ...euTractor(),
    },
    bulk: { kind: 'tank', compartments: compartments(10.0, [8000, 8000, 8000]), baffled: true, foodGrade: true, insulated: true, pressurised: false },
  }),
  'tanker-lpg-44k': () => ({
    presetId: 'tanker-lpg-44k',
    name: 'LPG tanker 44,000 L (semi, pressurised)',
    region: 'EU',
    ...tankerBase(12.0, 2.4, 2.4),
    grossLimitKg: 40_000,
    payloadKg: 20_200,
    deckHeight: 1.25,
    bayLength: 3.0,
    fuel: { emptyLPer100km: 24, fullLPer100km: 32, idleLPerHour: 2.5, reeferLPerHour: 0, tankL: 600 },
    statics: {
      type: 'artic',
      kingpinX: 1.0,
      trailerAxle: { id: 'trailer', label: 'Trailer tridem', x: 8.4, count: 3, spread: 2.62, tareKg: 0, maxKg: 24_000 },
      trailerTareKg: 12_000,
      trailerTareX: 6.5,
      ...euTractor(),
    },
    // One cylindrical pressure vessel with surge plates; LPG fills to 85 % at most.
    bulk: { kind: 'tank', compartments: compartments(12.0, [44_000]), baffled: true, foodGrade: false, insulated: false, pressurised: true },
  }),
  'container-20': () => ({
    presetId: 'container-20',
    name: '20 ft container (dry)',
    region: 'INTL',
    kind: 'container',
    ...truckBase(5.9, 2.35, 2.39, 2.34, 2.28),
    grossLimitKg: 36_000,
    // Container rating 30,480 kg gross less 2,230 kg tare; the 4-axle road train limits it first.
    payloadKg: 28_250,
    floorKgPerM: 4500,
    maxCogHeight: 1.5,
    deckHeight: 1.35,
    bayLength: 1.2,
    fuel: { emptyLPer100km: 23, fullLPer100km: 32, idleLPerHour: 2.5, reeferLPerHour: 0, tankL: 400 },
    statics: isoChassis(4.6, 2, 5430, 3.2),
  }),
  'container-40': () => ({
    presetId: 'container-40',
    name: '40 ft container (dry)',
    region: 'INTL',
    kind: 'container',
    ...truckBase(12.03, 2.35, 2.39, 2.34, 2.28),
    grossLimitKg: 40_000,
    // 30,480 kg rating less 3,750 kg tare; road-limited on a 40 t combination.
    payloadKg: 26_730,
    floorKgPerM: 3000,
    maxCogHeight: 1.5,
    deckHeight: 1.35,
    bayLength: 1.2,
    fuel: { emptyLPer100km: 24, fullLPer100km: 34, idleLPerHour: 2.5, reeferLPerHour: 0, tankL: 400 },
    statics: isoChassis(9.6, 3, 8550, 6.3),
  }),
  'container-40hc-reefer': () => ({
    presetId: 'container-40hc-reefer',
    name: '40 ft high-cube reefer container',
    region: 'INTL',
    kind: 'container',
    ...truckBase(11.58, 2.29, 2.55, 2.29, 2.5),
    tempControlled: true,
    zones: fullZone(11.58, 'frozen'),
    // Stay below the red load line so the cold air can circulate.
    airflowTopGap: 0.12,
    grossLimitKg: 40_000,
    payloadKg: 25_680,
    floorKgPerM: 3000,
    maxCogHeight: 1.5,
    deckHeight: 1.4,
    bayLength: 1.2,
    // Clip-on genset runs the reefer unit.
    fuel: { emptyLPer100km: 24, fullLPer100km: 34, idleLPerHour: 2.5, reeferLPerHour: 2.5, tankL: 400 },
    statics: isoChassis(9.6, 3, 9600, 6.2),
  }),
  'id-pickup': () => ({
    presetId: 'id-pickup',
    name: 'Pick-up 1 t (Gran Max / Carry)',
    region: 'ID',
    kind: 'rigid',
    body: 'dropside',
    ...truckBase(2.45, 1.6, 1.2, 1.6, 1.2),
    access: ['rear', 'side', 'top'],
    walls: false,
    grossLimitKg: 2200,
    payloadKg: 1000,
    floorKgPerM: 800,
    maxCogHeight: 0.9,
    deckHeight: 0.75,
    bayLength: 0.6,
    fuel: { emptyLPer100km: 8, fullLPer100km: 10, idleLPerHour: 0.7, reeferLPerHour: 0, tankL: 43 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -1.0, count: 1, spread: 0, tareKg: 600, maxKg: 1000, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear axle', x: 1.65, count: 1, spread: 0, tareKg: 450, maxKg: 1400, minShare: 0.25, driven: true },
    },
  }),
  'id-cde-box': () => ({
    presetId: 'id-cde-box',
    name: 'CDE box truck (Engkel, 4 wheels)',
    region: 'ID',
    kind: 'rigid',
    ...truckBase(3.1, 1.7, 1.8, 1.6, 1.7),
    grossLimitKg: 5500,
    payloadKg: 2500,
    floorKgPerM: 1500,
    maxCogHeight: 1.3,
    deckHeight: 1.0,
    bayLength: 0.8,
    fuel: { emptyLPer100km: 11, fullLPer100km: 14, idleLPerHour: 1.0, reeferLPerHour: 0, tankL: 100 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -0.8, count: 1, spread: 0, tareKg: 1550, maxKg: 2100, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear axle', x: 1.75, count: 1, spread: 0, tareKg: 1050, maxKg: 3600, minShare: 0.25, driven: true },
    },
  }),
  'id-cdd-box': () => ({
    presetId: 'id-cdd-box',
    name: 'CDD box truck (Double, 6 wheels)',
    region: 'ID',
    kind: 'rigid',
    ...truckBase(4.3, 2.0, 2.0, 1.9, 1.9),
    grossLimitKg: 8250,
    payloadKg: 4500,
    floorKgPerM: 2000,
    maxCogHeight: 1.4,
    deckHeight: 1.05,
    bayLength: 1.0,
    fuel: { emptyLPer100km: 13, fullLPer100km: 17, idleLPerHour: 1.2, reeferLPerHour: 0, tankL: 100 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -0.65, count: 1, spread: 0, tareKg: 2100, maxKg: 3000, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear axle', x: 2.7, count: 1, spread: 0, tareKg: 1500, maxKg: 5600, minShare: 0.25, driven: true },
    },
  }),
  'id-cdd-reefer': () => ({
    presetId: 'id-cdd-reefer',
    name: 'CDD reefer box (frozen, 6 wheels)',
    region: 'ID',
    kind: 'rigid',
    ...truckBase(4.0, 1.85, 1.85, 1.75, 1.75),
    tempControlled: true,
    zones: fullZone(4.0, 'frozen'),
    airflowTopGap: 0.1,
    grossLimitKg: 8250,
    payloadKg: 3800,
    floorKgPerM: 2000,
    maxCogHeight: 1.3,
    deckHeight: 1.1,
    bayLength: 1.0,
    fuel: { emptyLPer100km: 13, fullLPer100km: 17, idleLPerHour: 1.2, reeferLPerHour: 1.5, tankL: 100 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -0.65, count: 1, spread: 0, tareKg: 2150, maxKg: 3000, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear axle', x: 2.7, count: 1, spread: 0, tareKg: 2050, maxKg: 5600, minShare: 0.25, driven: true },
    },
  }),
  'id-fuso-box': () => ({
    presetId: 'id-fuso-box',
    name: 'Fuso box truck (medium 4×2)',
    region: 'ID',
    kind: 'rigid',
    ...truckBase(6.5, 2.35, 2.4, 2.25, 2.3),
    grossLimitKg: 16_000,
    payloadKg: 9000,
    floorKgPerM: 2500,
    maxCogHeight: 1.6,
    deckHeight: 1.15,
    bayLength: 1.3,
    fuel: { emptyLPer100km: 17, fullLPer100km: 23, idleLPerHour: 1.5, reeferLPerHour: 0, tankL: 200 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -1.1, count: 1, spread: 0, tareKg: 3900, maxKg: 6000, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear axle', x: 4.3, count: 1, spread: 0, tareKg: 2600, maxKg: 10_000, minShare: 0.25, driven: true },
    },
  }),
  'id-tronton-wingbox': () => ({
    presetId: 'id-tronton-wingbox',
    name: 'Tronton wingbox (6×2, 10 wheels)',
    region: 'ID',
    kind: 'rigid',
    body: 'wingbox',
    ...truckBase(9.4, 2.45, 2.5, 2.35, 2.4),
    access: ['rear', 'side', 'top'],
    grossLimitKg: 26_000,
    payloadKg: 15_500,
    floorKgPerM: 3000,
    maxCogHeight: 1.7,
    deckHeight: 1.25,
    bayLength: 1.2,
    fuel: { emptyLPer100km: 24, fullLPer100km: 32, idleLPerHour: 2.0, reeferLPerHour: 0, tankL: 200 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -1.2, count: 1, spread: 0, tareKg: 4200, maxKg: 7500, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear tandem', x: 6.1, count: 2, spread: 1.3, tareKg: 6100, maxKg: 19_000, minShare: 0.25, driven: true },
    },
  }),
  'id-trailer-wingbox': () => ({
    presetId: 'id-trailer-wingbox',
    name: 'Trailer wingbox 12.5 m (tractor 6×4)',
    region: 'ID',
    kind: 'semi',
    body: 'wingbox',
    ...truckBase(12.5, 2.45, 2.6, 2.4, 2.5),
    access: ['rear', 'side', 'top'],
    grossLimitKg: 44_000,
    payloadKg: 26_000,
    floorKgPerM: 3500,
    maxCogHeight: 1.8,
    deckHeight: 1.3,
    bayLength: 1.25,
    fuel: { emptyLPer100km: 30, fullLPer100km: 40, idleLPerHour: 2.5, reeferLPerHour: 0, tankL: 400 },
    statics: {
      type: 'artic',
      kingpinX: 1.0,
      trailerAxle: { id: 'trailer', label: 'Trailer tridem', x: 10.2, count: 3, spread: 2.62, tareKg: 0, maxKg: 24_000 },
      trailerTareKg: 7800,
      trailerTareX: 6.5,
      steer: { id: 'steer', label: 'Steer axle', x: 0, count: 1, spread: 0, tareKg: 5200, maxKg: 7500, minShare: 0.1, steer: true },
      drive: { id: 'drive', label: 'Drive tandem', x: 4.2, count: 2, spread: 1.35, tareKg: 4300, maxKg: 19_000, minShare: 0.25, driven: true },
      fifthWheelX: 3.9,
    },
  }),
  'id-dump-cdd': () => ({
    presetId: 'id-dump-cdd',
    name: 'Dump truck CDD (4×2, 6 wheels)',
    region: 'ID',
    ...tipperBase(3.4, 1.95, 0.7),
    grossLimitKg: 8250,
    payloadKg: 4500,
    deckHeight: 1.1,
    bayLength: 1.7,
    fuel: { emptyLPer100km: 14, fullLPer100km: 19, idleLPerHour: 1.3, reeferLPerHour: 0, tankL: 100 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -0.75, count: 1, spread: 0, tareKg: 2000, maxKg: 3000, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear axle', x: 2.3, count: 1, spread: 0, tareKg: 1700, maxKg: 5600, minShare: 0.25, driven: true },
    },
  }),
  'id-dump-tronton': () => ({
    presetId: 'id-dump-tronton',
    name: 'Dump truck tronton (6×4, 10 wheels)',
    region: 'ID',
    ...tipperBase(5.8, 2.3, 1.2),
    grossLimitKg: 26_000,
    payloadKg: 15_000,
    deckHeight: 1.4,
    bayLength: 1.45,
    fuel: { emptyLPer100km: 28, fullLPer100km: 38, idleLPerHour: 2.2, reeferLPerHour: 0, tankL: 200 },
    statics: {
      type: 'rigid',
      front: { id: 'front', label: 'Front axle', x: -1.6, count: 1, spread: 0, tareKg: 4600, maxKg: 7500, minShare: 0.2, steer: true },
      rear: { id: 'rear', label: 'Rear tandem', x: 3.9, count: 2, spread: 1.3, tareKg: 6400, maxKg: 19_000, minShare: 0.25, driven: true },
    },
  }),
};

export const VEHICLE_PRESETS: VehiclePresetInfo[] = [
  { id: 'eu-van-35', name: 'EU van 3.5 t', region: 'EU', summary: '4.3 m · 1.2 t · side door' },
  { id: 'eu-rigid-18', name: 'EU box truck 18 t', region: 'EU', summary: '7.3 m · 9.5 t · 18 EUR pallets' },
  { id: 'eu-curtainsider-136', name: 'EU 13.6 m curtainsider', region: 'EU', summary: '13.6 m · 25.7 t · 33 EUR pallets' },
  { id: 'us-dry-van-53', name: 'US 53 ft dry van', region: 'US', summary: '16.0 m · 20.4 t · sliding tandem' },
  { id: 'us-reefer-53', name: 'US 53 ft reefer (multi-temp)', region: 'US', summary: '15.7 m · 20.0 t · 3 temp zones' },
  { id: 'container-40hc', name: 'US 40 ft high-cube container', region: 'US', summary: '12.03 m · 26.6 t box · road-limited' },
  { id: 'us-flatbed-48', name: 'US 48 ft flatbed', region: 'US', summary: '14.6 m · 21.5 t · open deck' },
  { id: 'id-pickup', name: 'Pick-up 1 t (Gran Max / Carry)', region: 'ID', summary: '2.45 m bed · 1 t · open dropside' },
  { id: 'id-cde-box', name: 'CDE box truck (Engkel, 4 wheels)', region: 'ID', summary: '3.1 m box · 2.5 t' },
  { id: 'id-cdd-box', name: 'CDD box truck (Double, 6 wheels)', region: 'ID', summary: '4.3 m box · 4.5 t' },
  { id: 'id-cdd-reefer', name: 'CDD reefer box (frozen, 6 wheels)', region: 'ID', summary: '4.0 m · 3.8 t · frozen' },
  { id: 'id-fuso-box', name: 'Fuso box truck (medium 4×2)', region: 'ID', summary: '6.5 m box · 9 t' },
  { id: 'id-tronton-wingbox', name: 'Tronton wingbox (6×2, 10 wheels)', region: 'ID', summary: '9.4 m · 15.5 t · side loading' },
  { id: 'id-trailer-wingbox', name: 'Trailer wingbox 12.5 m (tractor 6×4)', region: 'ID', summary: '12.5 m · 26 t · side loading' },
  { id: 'id-dump-cdd', name: 'Dump truck CDD (4×2, 6 wheels)', region: 'ID', summary: '4.6 m³ body · 4.5 t' },
  { id: 'id-dump-tronton', name: 'Dump truck tronton (6×4, 10 wheels)', region: 'ID', summary: '16 m³ body · 15 t' },
  { id: 'container-20', name: '20 ft container (dry)', region: 'INTL', summary: '5.90 m · 28.2 t box · road-limited' },
  { id: 'container-40', name: '40 ft container (dry)', region: 'INTL', summary: '12.03 m · 26.7 t box · road-limited' },
  { id: 'container-40hc-reefer', name: '40 ft high-cube reefer container', region: 'INTL', summary: '11.58 m · frozen · genset' },
  { id: 'tanker-rigid-16k', name: 'Fuel tanker 16,000 L (rigid 6×4)', region: 'EU', summary: '4 × 4,000 L · 16 t payload' },
  { id: 'tanker-semi-32k', name: 'Fuel tanker 32,000 L (semi-trailer)', region: 'EU', summary: '5 compartments · 25.1 t payload' },
  { id: 'tanker-water-8k', name: 'Water tanker 8,000 L (rigid 4×2)', region: 'EU', summary: '1 baffled compartment · food-grade' },
  { id: 'tanker-food-24k', name: 'Food-grade tanker 24,000 L (semi, insulated)', region: 'EU', summary: '3 × 8,000 L · milk, edible oil' },
  { id: 'tanker-lpg-44k', name: 'LPG tanker 44,000 L (semi, pressurised)', region: 'EU', summary: '1 pressure vessel · 85 % max fill · 20.2 t LPG' },
];

/** Fresh, independent vehicle built from a preset. */
export function createVehicle(presetId: string, id: string = uid('veh')): Vehicle {
  const build = PRESETS[presetId];
  if (!build) throw new Error(`Unknown vehicle preset: ${presetId}`);
  return { id, ...build() };
}

/** Blank custom vehicle (rigid, editable in the vehicle editor). */
export function createCustomVehicle(id: string = uid('veh')): Vehicle {
  return { ...createVehicle('eu-rigid-18', id), presetId: 'custom', name: 'Custom vehicle', region: 'custom' };
}

/**
 * Fuel profile for a vehicle saved before fuel profiles existed: its preset's profile, otherwise a
 * typical profile for its kind (plus a reefer unit when temperature controlled).
 */
export function defaultFuelProfile(v: Pick<Vehicle, 'presetId' | 'kind' | 'tempControlled'>): FuelProfile {
  const preset = PRESETS[v.presetId];
  if (preset) return { ...preset().fuel };
  const base = v.kind === 'van' ? PRESETS['eu-van-35']() : v.kind === 'rigid' ? PRESETS['eu-rigid-18']() : PRESETS['us-dry-van-53']();
  return { ...base.fuel, reeferLPerHour: v.tempControlled ? (v.kind === 'van' ? 1.2 : 3.4) : 0 };
}

/** Vehicle tare (empty) weight, kg. */
export function vehicleTareKg(v: Vehicle): number {
  const s = v.statics;
  return s.type === 'rigid' ? s.front.tareKg + s.rear.tareKg : s.steer.tareKg + s.drive.tareKg + s.trailerTareKg;
}

/** Slider hole positions (trailer axle group centre, metres from the front wall). */
export function sliderPositions(v: Vehicle): number[] {
  if (v.statics.type !== 'artic' || !v.statics.slider) return [];
  const { minX, step, holes } = v.statics.slider;
  return Array.from({ length: holes }, (_, i) => minX + i * step);
}
