import { stopColor } from '../domain/colors';
import { uid } from '../domain/ids';
import { createVehicle } from '../domain/presets';
import { defaultSettings } from '../domain/settings';
import type { Customer, Plan, Stop } from '../domain/types';

/** Today's date in local time, YYYY-MM-DD. */
function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A fresh plan with one vehicle from `presetId`, one delivery stop and no cargo. */
export function createEmptyPlan(presetId = 'eu-rigid-18'): Plan {
  const vehicle = createVehicle(presetId);
  vehicle.name = `Truck 1 · ${vehicle.name}`;
  const customer: Customer = { id: uid('cust'), name: 'Customer 1', color: stopColor(1) };
  const stop: Stop = { id: uid('stop'), name: 'Stop 1', customerId: customer.id, sequence: 1 };
  return {
    version: 1,
    id: uid('plan'),
    name: 'New load plan',
    meta: {
      date: localDate(),
      time: '08:00',
      dock: '',
      route: '',
      distanceKm: 0,
      driver: '',
      notes: '',
    },
    customers: [customer],
    stops: [stop],
    lines: [],
    vehicles: [vehicle],
    placements: {},
    settings: defaultSettings(),
  };
}
