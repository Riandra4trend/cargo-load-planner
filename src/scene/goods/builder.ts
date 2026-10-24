import { BoxGeometry, BufferAttribute, Color, CylinderGeometry, SphereGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Builds a goods model from primitives in ITEM-LOCAL coordinates: x along the item length (l), y along
 * its width (w), z up its height (h), origin at the minimum corner. Every part is clipped to the item
 * box, so a finished model never exceeds L × W × H. Geometry is stored in three.js axes of the
 * unrotated item (X = x, Y = z, Z = -y), the same convention as scene/coords.ts.
 */

export type Layer = 'solid' | 'tag' | 'film';
export type V3 = readonly [number, number, number];

/** Default upper bound on parts per unit (keeps 300 units fast). */
export const MAX_PARTS = 120;

const scratch = new Color();

export class PartBuilder {
  readonly layers: Record<Layer, BufferGeometry[]> = { solid: [], tag: [], film: [] };
  count = 0;

  constructor(
    readonly l: number,
    readonly w: number,
    readonly h: number,
    readonly maxParts = MAX_PARTS,
  ) {}

  /** Parts that may still be added. */
  get room(): number {
    return this.maxParts - this.count;
  }

  /** Axis-aligned box between two item-local corners, clipped to the item box. */
  box(min: V3, max: V3, color: Color | string | null, layer: Layer = 'solid'): void {
    if (this.count >= this.maxParts) return;
    const x0 = Math.max(0, Math.min(min[0], max[0]));
    const y0 = Math.max(0, Math.min(min[1], max[1]));
    const z0 = Math.max(0, Math.min(min[2], max[2]));
    const x1 = Math.min(this.l, Math.max(min[0], max[0]));
    const y1 = Math.min(this.w, Math.max(min[1], max[1]));
    const z1 = Math.min(this.h, Math.max(min[2], max[2]));
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const g = new BoxGeometry(x1 - x0, z1 - z0, y1 - y0);
    g.translate((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2);
    this.push(g, color, layer);
  }

  /** Cylinder centred at an item-local point along a local axis; shrunk if needed to stay inside the item box. */
  cylinder(centre: V3, radius: number, length: number, axis: 0 | 1 | 2, color: Color | string | null, layer: Layer = 'solid', segments = 20): void {
    if (this.count >= this.maxParts) return;
    const dims = [this.l, this.w, this.h];
    let r = radius;
    let len = length;
    for (let a = 0; a < 3; a++) {
      const room = Math.min(centre[a], dims[a] - centre[a]);
      if (a === axis) len = Math.min(len, 2 * room);
      else r = Math.min(r, room);
    }
    if (r < 1e-3 || len < 1e-3) return;
    const g = new CylinderGeometry(r, r, len, segments, 1);
    if (axis === 0) g.rotateZ(-Math.PI / 2);
    else if (axis === 1) g.rotateX(Math.PI / 2);
    g.translate(centre[0], centre[2], -centre[1]);
    this.push(g, color, layer);
  }

  /** Low-poly sphere (fruit, caps), shrunk to stay inside the item box. */
  sphere(centre: V3, radius: number, color: Color | string): void {
    if (this.count >= this.maxParts) return;
    const dims = [this.l, this.w, this.h];
    let r = radius;
    for (let a = 0; a < 3; a++) r = Math.min(r, centre[a], dims[a] - centre[a]);
    if (r < 1e-3) return;
    const g = new SphereGeometry(r, 8, 5);
    g.translate(centre[0], centre[2], -centre[1]);
    this.push(g, color, 'solid');
  }

  private push(g: BufferGeometry, color: Color | string | null, layer: Layer): void {
    if (layer === 'solid') {
      const c = color === null ? scratch.set('#ffffff') : typeof color === 'string' ? scratch.set(color) : color;
      const n = g.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new BufferAttribute(arr, 3));
    }
    this.layers[layer].push(g);
    this.count++;
  }

  /** Merges each layer into one geometry (null when empty) and frees the parts. */
  merge(): Record<Layer, BufferGeometry | null> {
    const out = { solid: null, tag: null, film: null } as Record<Layer, BufferGeometry | null>;
    for (const layer of ['solid', 'tag', 'film'] as const) {
      const parts = this.layers[layer];
      if (!parts.length) continue;
      const merged = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      if (!merged) throw new Error(`Could not merge ${layer} goods geometry`);
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      out[layer] = merged;
    }
    return out;
  }
}

/** Deterministic pseudo-random generator (mulberry32) seeded from a string. */
export function seededRandom(seedText: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < seedText.length; i++) a = Math.imul(a ^ seedText.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A colour with a deterministic lightness / hue jitter (amount = max lightness offset). */
export function vary(hex: string, rnd: () => number, amount: number, hue = 0): Color {
  return new Color(hex).offsetHSL((rnd() - 0.5) * hue, 0, (rnd() - 0.5) * 2 * amount);
}
