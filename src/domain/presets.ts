import { uid } from './ids';
import { lbToKg } from './units';
import type { AxleGroup, FuelProfile, TempZone, Vehicle } from './types';

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
    name: '40 ft high-cube container',
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
};

export const VEHICLE_PRESETS: VehiclePresetInfo[] = [
  { id: 'eu-van-35', name: 'EU van 3.5 t', region: 'EU', summary: '4.3 m · 1.2 t · side door' },
  { id: 'eu-rigid-18', name: 'EU box truck 18 t', region: 'EU', summary: '7.3 m · 9.5 t · 18 EUR pallets' },
  { id: 'eu-curtainsider-136', name: 'EU 13.6 m curtainsider', region: 'EU', summary: '13.6 m · 25.7 t · 33 EUR pallets' },
  { id: 'us-dry-van-53', name: 'US 53 ft dry van', region: 'US', summary: '16.0 m · 20.4 t · sliding tandem' },
  { id: 'us-reefer-53', name: 'US 53 ft reefer (multi-temp)', region: 'US', summary: '15.7 m · 20.0 t · 3 temp zones' },
  { id: 'container-40hc', name: '40 ft high-cube container', region: 'US', summary: '12.03 m · 26.6 t box · road-limited' },
  { id: 'us-flatbed-48', name: 'US 48 ft flatbed', region: 'US', summary: '14.6 m · 21.5 t · open deck' },
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
