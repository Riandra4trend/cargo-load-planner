import type { TempClass } from './types';

/** Okabe–Ito based, colour-blind-safe palette for stops/customers (index = stop sequence - 1). */
export const STOP_PALETTE = ['#E69F00', '#56B4E9', '#009E73', '#CC79A7', '#0072B2', '#D55E00', '#B8A200', '#7A7A7A'];

export const stopColor = (sequence: number): string => STOP_PALETTE[(Math.max(1, sequence) - 1) % STOP_PALETTE.length];

export const TEMP_COLORS: Record<TempClass, string> = {
  ambient: '#B9A27A',
  chilled: '#4FA3D9',
  frozen: '#3B5BDB',
};

export const TEMP_LABELS: Record<TempClass, string> = {
  ambient: 'Ambient',
  chilled: 'Chilled',
  frozen: 'Frozen',
};

/** Hazmat colour by primary class digit (roughly matching placard colours). */
export function hazmatColor(hazClass: string | undefined): string {
  if (!hazClass) return '#D9D6CF';
  const major = hazClass.split('.')[0];
  switch (major) {
    case '1':
      return '#F08C00';
    case '2':
      return hazClass === '2.2' ? '#2F9E44' : '#E03131';
    case '3':
      return '#E03131';
    case '4':
      return '#C2255C';
    case '5':
      return '#F2C200';
    case '6':
      return '#868E96';
    case '7':
      return '#FAB005';
    case '8':
      return '#343A40';
    case '9':
      return '#7048E8';
    default:
      return '#D9D6CF';
  }
}

/** Heat-map colour for a 0..1 value (light sand -> orange -> deep red). */
export function heatColor(t: number): string {
  const v = Math.min(1, Math.max(0, t));
  const stops: [number, [number, number, number]][] = [
    [0, [237, 233, 222]],
    [0.5, [245, 158, 11]],
    [1, [185, 28, 28]],
  ];
  let i = 0;
  while (i < stops.length - 2 && v > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i];
  const [t1, c1] = stops[i + 1];
  const k = (v - t0) / (t1 - t0);
  const mix = c0.map((c, j) => Math.round(c + (c1[j] - c) * k));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}
