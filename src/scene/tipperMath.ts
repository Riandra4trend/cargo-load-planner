/**
 * Pure geometry for dump-truck (tipper) bodies: the shape of a material heap for a fill fraction and the
 * tipping rotation about the rear hinge. Cargo coordinates (x toward the rear, z up), metres.
 */

/** Heap inside a body of inside length `l`, width `w` and side height `h`. */
export interface HeapShape {
  /** Height of the flat part of the heap above the body floor. */
  level: number;
  /** Extra height of the mound (half-ellipsoid) on top of the flat part. */
  mound: number;
  /** Mound footprint as fractions of the body length / width. */
  moundL: number;
  moundW: number;
}

const MOUND_L = 0.85;
const MOUND_W = 0.8;

/**
 * Heap whose volume is `fill` × the struck body volume (l × w × h): a flat layer plus a gentle mound
 * (a half ellipsoid over 85 % × 80 % of the floor). The mound grows with the fill up to 20 % of the side
 * height (max 0.3 m); fills above 1 rise over the sides (heaped / over-dimension loads).
 */
export function heapShape(fill: number, l: number, w: number, h: number, out: HeapShape = { level: 0, mound: 0, moundL: MOUND_L, moundW: MOUND_W }): HeapShape {
  const f = Math.max(0, fill);
  out.moundL = MOUND_L;
  out.moundW = MOUND_W;
  if (f <= 0 || l <= 0 || w <= 0 || h <= 0) {
    out.level = 0;
    out.mound = 0;
    return out;
  }
  const volume = f * l * w * h;
  const moundArea = Math.PI * ((MOUND_L * l) / 2) * ((MOUND_W * w) / 2);
  let mound = Math.min(0.3, h * 0.2) * Math.min(1, f * 2);
  // Half ellipsoid volume = 2/3 · area · height; keep it below the volume so the flat layer stays >= 0.
  mound = Math.min(mound, (volume / moundArea) * 1.5 * 0.6);
  out.level = (volume - (2 / 3) * moundArea * mound) / (l * w);
  out.mound = mound;
  return out;
}

/** Volume of a heap shape (inverse of heapShape, for tests and labels). */
export function heapVolume(shape: HeapShape, l: number, w: number): number {
  return shape.level * l * w + (2 / 3) * Math.PI * ((shape.moundL * l) / 2) * ((shape.moundW * w) / 2) * shape.mound;
}

/**
 * Position of a body point (x, z) after tipping the body by `angle` radians about the rear hinge at
 * (hingeX, hingeZ): the front rises and points above the hinge swing rearwards.
 */
export function tipPoint(angle: number, hingeX: number, hingeZ: number, x: number, z: number): { x: number; z: number } {
  const rx = x - hingeX;
  const rz = z - hingeZ;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: hingeX + rx * c + rz * s, z: hingeZ - rx * s + rz * c };
}

/** Maximum tipping angle, radians (≈ 45°). */
export const MAX_TIP = Math.PI / 4;

/**
 * Unload timeline for one stop, t ∈ [0, 1]: the body rises (0–0.3), holds while the material slides
 * out (0.3–0.75) and lowers again (0.75–1). Returns the tip angle and the fraction of material out.
 */
export function tipTimeline(t: number): { angle: number; out: number } {
  const k = Math.min(1, Math.max(0, t));
  const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
  const up = k < 0.3 ? ease(k / 0.3) : k < 0.75 ? 1 : 1 - ease((k - 0.75) / 0.25);
  const out = k < 0.18 ? 0 : k > 0.72 ? 1 : ease((k - 0.18) / 0.54);
  return { angle: up * MAX_TIP, out };
}
