import type { FuelProfile, Id, Plan, Vehicle } from '../domain/types';

/** One cargo unit as the fuel model sees it. */
export interface FuelCargo {
  stopSeq: number;
  kg: number;
  /** Chilled or frozen: keeps the reefer running while aboard. */
  cold: boolean;
}

export interface FuelLeg {
  /** "Depot → 1", "1 → 2", "5 → Depot". */
  label: string;
  /** Destination stop; undefined for the return leg. */
  stopId?: Id;
  km: number;
  /** Cargo aboard while driving this leg, kg. */
  cargoKg: number;
  lPer100km: number;
  /** Driving fuel for this leg, litres. */
  litres: number;
  /** Driving time, hours. */
  hours: number;
  /** Chilled or frozen cargo aboard, so the reefer runs. */
  cold: boolean;
}

export interface FuelEstimate {
  legs: FuelLeg[];
  km: number;
  drivingL: number;
  idleL: number;
  reeferL: number;
  totalL: number;
  /** Driving fuel per 100 km over the route (0 without distance). */
  avgLPer100km: number;
  /** Cargo moved, tonne-kilometres. */
  tonneKm: number;
  /** Driving fuel per 100 tonne-km of cargo moved (0 when nothing is moved). */
  lPer100Tkm: number;
  /** Driving time plus time at the stops, hours. */
  hours: number;
  stopsVisited: number;
  cost: number;
  co2Kg: number;
  /** totalL / tank capacity. */
  tankShare: number;
}

/** Driving consumption at a cargo weight: linear between empty and full (rated payload), extrapolated above. */
export function consumptionAt(profile: FuelProfile, cargoKg: number, payloadKg: number): number {
  const ratio = payloadKg > 0 ? Math.max(0, cargoKg) / payloadKg : 0;
  return profile.emptyLPer100km + (profile.fullLPer100km - profile.emptyLPer100km) * ratio;
}

/** Route length: each stop's leg from the previous stop plus the empty return leg, km. */
export function routeKm(plan: Pick<Plan, 'stops' | 'meta'>): number {
  return plan.stops.reduce((sum, s) => sum + Math.max(0, s.distanceKm ?? 0), 0) + Math.max(0, plan.meta.returnKm);
}

/**
 * Fuel for one vehicle that drives the route in stop order up to its last stop with cargo, then returns
 * to the depot empty. Each leg burns at the consumption for the cargo still aboard (deliveries come off at
 * every stop); the reefer runs while chilled or frozen cargo is aboard, driving and during the stop; the
 * engine idles at every stop.
 */
export function estimateFuel(vehicle: Vehicle, plan: Pick<Plan, 'stops' | 'meta' | 'settings'>, cargo: readonly FuelCargo[]): FuelEstimate {
  const { settings } = plan;
  const profile = vehicle.fuel;
  const lastSeq = cargo.reduce((m, c) => Math.max(m, c.stopSeq), 0);
  const stops = plan.stops.filter((s) => s.sequence <= lastSeq).sort((a, b) => a.sequence - b.sequence);
  const speed = settings.avgSpeedKmh > 0 ? settings.avgSpeedKmh : Number.POSITIVE_INFINITY;
  const dwellHours = Math.max(0, settings.stopMinutes) / 60;

  const legs: FuelLeg[] = [];
  let reeferHours = 0;
  let from = 'Depot';
  for (const s of stops) {
    const aboard = cargo.filter((c) => c.stopSeq >= s.sequence);
    const cargoKg = aboard.reduce((sum, c) => sum + c.kg, 0);
    const cold = aboard.some((c) => c.cold);
    const km = Math.max(0, s.distanceKm ?? 0);
    const lPer100km = consumptionAt(profile, cargoKg, vehicle.payloadKg);
    const hours = km / speed;
    legs.push({ label: `${from} → ${s.sequence}`, stopId: s.id, km, cargoKg, lPer100km, litres: (km * lPer100km) / 100, hours, cold });
    if (cold) reeferHours += hours + dwellHours;
    from = String(s.sequence);
  }
  if (legs.length && plan.meta.returnKm > 0) {
    const km = plan.meta.returnKm;
    legs.push({ label: `${from} → Depot`, km, cargoKg: 0, lPer100km: profile.emptyLPer100km, litres: (km * profile.emptyLPer100km) / 100, hours: km / speed, cold: false });
  }

  let km = 0;
  let drivingL = 0;
  let drivingHours = 0;
  let tonneKm = 0;
  for (const leg of legs) {
    km += leg.km;
    drivingL += leg.litres;
    drivingHours += leg.hours;
    tonneKm += (leg.cargoKg / 1000) * leg.km;
  }
  const idleL = (stops.length * profile.idleLPerHour * Math.max(0, settings.idleMinutesPerStop)) / 60;
  const reeferL = profile.reeferLPerHour * reeferHours;
  const totalL = drivingL + idleL + reeferL;
  return {
    legs,
    km,
    drivingL,
    idleL,
    reeferL,
    totalL,
    avgLPer100km: km > 0 ? (drivingL / km) * 100 : 0,
    tonneKm,
    lPer100Tkm: tonneKm > 0 ? (drivingL / tonneKm) * 100 : 0,
    hours: drivingHours + stops.length * dwellHours,
    stopsVisited: stops.length,
    cost: totalL * settings.fuelPricePerL,
    co2Kg: totalL * settings.co2KgPerL,
    tankShare: profile.tankL > 0 ? totalL / profile.tankL : 0,
  };
}
