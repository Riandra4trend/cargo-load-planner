import type { Hazmat, TankCompartment, Vehicle } from '../domain/types';

/** Fraction of an ellipse's area below a horizontal line at normalised height u ∈ [-1, 1] (centre = 0). */
function segmentFraction(u: number): number {
  const c = Math.min(1, Math.max(-1, u));
  return (c * Math.sqrt(1 - c * c) + Math.asin(c)) / Math.PI + 0.5;
}

/**
 * Liquid level in an elliptical (or circular) tank cross-section of the given height: the height above
 * the tank bottom at which the area below equals `fill` (0..1) of the whole section. The horizontal
 * semi-axis cancels out, so only the height matters. Monotonic; 0 → 0, 1 → height, 0.5 → height / 2.
 */
export function liquidLevel(fill: number, height: number): number {
  const f = Math.min(1, Math.max(0, fill));
  if (f <= 0) return 0;
  if (f >= 1) return height;
  let lo = -1;
  let hi = 1;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (segmentFraction(mid) < f) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2 + 1) * (height / 2);
}

/** Width of an ellipse (full width `width`, full height `height`) at `level` above its bottom. */
export function chordWidth(level: number, width: number, height: number): number {
  const u = (2 * level) / height - 1;
  return width * Math.sqrt(Math.max(0, 1 - u * u));
}

/** Depth of the tank's end heads: hemispherical on pressure vessels, shallow dished ends otherwise. */
export function capDepth(v: Vehicle): number {
  return v.tank?.pressurised ? Math.min(v.cargo.w, v.cargo.h) / 2 : Math.min(0.24, v.cargo.h * 0.14);
}

/**
 * Cylindrical part of the tank along cargo x. Pressure vessels fit their hemispherical heads inside the
 * cargo length; ordinary tanks have shallow dished heads just outside it.
 */
export function tankBarrel(v: Vehicle): { x0: number; x1: number; head: number } {
  const head = capDepth(v);
  return v.tank?.pressurised ? { x0: head, x1: v.cargo.l - head, head } : { x0: 0, x1: v.cargo.l, head };
}

/** Compartment of a tanker at cargo x (clamped to the first / last compartment beyond the ends). */
export function compartmentAtX(v: Vehicle, x: number): TankCompartment | undefined {
  const list = v.tank?.compartments ?? [];
  if (!list.length) return undefined;
  return list.find((c) => x >= c.fromX && x < c.toX) ?? (x < list[0].fromX ? list[0] : list[list.length - 1]);
}

/** ADR hazard identification number (upper half of the orange plate), illustrative mapping by class. */
export function hazardIdNumber(h: Hazmat): string {
  const major = h.hazClass.split('.')[0];
  if (h.hazClass === '2.1') return '23';
  if (h.hazClass === '2.2') return '20';
  if (h.hazClass === '2.3') return '26';
  if (major === '3') return h.packingGroup === 'III' ? '30' : '33';
  if (major === '8') return '80';
  if (major === '9') return '90';
  return `${major}0`;
}
