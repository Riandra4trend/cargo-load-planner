import { Color, type BufferGeometry } from 'three';
import type { ItemSpec } from '../../domain/types';
import { goodsArchetype, type GoodsArchetype } from './archetype';
import { PartBuilder, seededRandom, vary } from './builder';

/** One procedurally generated goods model (item-local, unrotated; see builder.ts for the axes). */
export interface GoodsModel {
  key: string;
  archetype: GoodsArchetype;
  /** Realistic parts with vertex colours. */
  solid: BufferGeometry;
  /** Colour-mode tags (corner boards, labels, bands): white, tinted per instance. */
  tags: BufferGeometry | null;
  /** Transparent stretch film. */
  film: BufferGeometry | null;
  parts: number;
}

/** Inset of the goods from the outer side faces: the gap holds the colour-mode tags. */
const INSET = 0.016;
/** Tag thickness. */
const TAG = 0.01;

/** Cache key: everything that changes the generated geometry. */
export function goodsKey(spec: ItemSpec): string {
  const mm = (m: number) => Math.round(m * 1000);
  return [
    spec.name,
    spec.category,
    spec.packaging,
    spec.shape,
    mm(spec.dims.l),
    mm(spec.dims.w),
    mm(spec.dims.h),
    mm(spec.palletHeight),
    spec.temp,
    spec.hazmat?.hazClass ?? '',
    spec.fragile ? 'F' : '',
    Math.sign(spec.cogOffset.x),
  ].join('|');
}

interface Region {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

interface Ctx {
  b: PartBuilder;
  rnd: () => number;
  spec: ItemSpec;
  r: Region;
}

const WOOD = '#c8a06a';
const WOOD_DARK = '#a07a4a';
const KRAFT = '#c99d63';
const LABEL = '#f6f4ee';
const BARCODE = '#2a2a2a';
const STEEL = '#8f969d';
const DARK_STEEL = '#3d4247';

/** Generates the realistic model of one unit. Pure; callers own (and dispose) the geometries. */
export function buildGoodsModel(spec: ItemSpec): GoodsModel {
  const { l, w, h } = spec.dims;
  const key = goodsKey(spec);
  const archetype = goodsArchetype(spec);
  const b = new PartBuilder(l, w, h);
  const rnd = seededRandom(key);
  const ph = spec.palletHeight > 0 && spec.palletHeight < h - 0.05 ? spec.palletHeight : 0;
  if (ph > 0) pallet(b, spec, ph, rnd);
  const ctx: Ctx = { b, rnd, spec, r: { x0: INSET, y0: INSET, z0: ph, x1: l - INSET, y1: w - INSET, z1: h - TAG } };

  if (archetype === 'drum' && spec.shape === 'cylinder-upright') drumTags(ctx);
  else if (archetype === 'paper-roll' || archetype === 'cable-reel') rollTags(ctx);
  else if (archetype !== 'machine') boxTags(ctx);

  BUILDERS[archetype](ctx);
  const merged = b.merge();
  if (!merged.solid) throw new Error(`Goods model for ${spec.name} has no geometry`);
  return { key, archetype, solid: merged.solid, tags: merged.tag, film: merged.film, parts: b.count };
}

export function disposeGoodsModel(m: GoodsModel): void {
  m.solid.dispose();
  m.tags?.dispose();
  m.film?.dispose();
}

// ---------------------------------------------------------------------------------------------
// Pallets
// ---------------------------------------------------------------------------------------------

function pallet(b: PartBuilder, spec: ItemSpec, ph: number, rnd: () => number): void {
  const { l, w } = b;
  const board = ph * 0.16;
  const wood = () => vary(WOOD, rnd, 0.05, 0.02);
  if (spec.packaging === 'us-pallet') {
    // GMA stringer pallet: three stringers along the length, deck boards across.
    for (const y of [0, (w - 0.045) / 2, w - 0.045]) b.box([0, y, board], [l, y + 0.045, ph - board], vary(WOOD_DARK, rnd, 0.04));
    const top = 7;
    const tw = Math.min(0.14, (l / top) * 0.8);
    for (let i = 0; i < top; i++) {
      const x = (i * (l - tw)) / (top - 1);
      b.box([x, 0, ph - board], [x + tw, w, ph], wood());
    }
    for (let i = 0; i < 3; i++) {
      const x = (i * (l - tw)) / 2;
      b.box([x, 0, 0], [x + tw, w, board], wood());
    }
    return;
  }
  // Block pallet (EUR, EUR half, industrial): bottom boards, 3×3 blocks, cross boards, top deck.
  const bw = Math.min(0.145, w * 0.18);
  const bl = Math.min(0.145, l * 0.12);
  const ys = [0, (w - bw) / 2, w - bw];
  const xs = [0, (l - bl) / 2, l - bl];
  for (const y of ys) b.box([0, y, 0], [l, y + bw, board], wood());
  for (const x of xs) for (const y of ys) b.box([x, y, board], [x + bl, y + bw, ph - 2 * board], vary(WOOD_DARK, rnd, 0.05));
  for (const x of xs) b.box([x, 0, ph - 2 * board], [x + bl, w, ph - board], wood());
  const deck = spec.packaging === 'industrial-pallet' ? 7 : 5;
  const dw = Math.min(0.145, (w / deck) * 0.78);
  for (let i = 0; i < deck; i++) {
    const y = (i * (w - dw)) / (deck - 1);
    b.box([0, y, ph - board], [l, y + dw, ph], wood());
  }
}

// ---------------------------------------------------------------------------------------------
// Colour-mode tags
// ---------------------------------------------------------------------------------------------

/** Corner boards on the four vertical edges, a label on each side and one on top. */
function boxTags({ b, r }: Ctx): void {
  const { l, w, h } = b;
  const o = INSET - TAG;
  const cb = Math.min(0.075, 0.25 * Math.min(l, w));
  const z0 = r.z0;
  const z1 = r.z1;
  for (const [x, sx] of [[o, 1], [l - o, -1]] as const) {
    for (const [y, sy] of [[o, 1], [w - o, -1]] as const) {
      b.box([x, y, z0], [x + sx * cb, y + sy * TAG, z1], null, 'tag');
      b.box([x, y, z0], [x + sx * TAG, y + sy * cb, z1], null, 'tag');
    }
  }
  const hh = z1 - z0;
  const lh = Math.min(0.3, Math.max(0.08, hh * 0.24));
  const top = z1 - Math.min(0.12, hh * 0.12);
  const lw = (len: number) => Math.min(0.5, Math.max(0.1, len * 0.38));
  const ax = lw(l) / 2;
  const ay = lw(w) / 2;
  b.box([l / 2 - ax, o, top - lh], [l / 2 + ax, INSET, top], null, 'tag');
  b.box([l / 2 - ax, w - INSET, top - lh], [l / 2 + ax, w - o, top], null, 'tag');
  b.box([o, w / 2 - ay, top - lh], [INSET, w / 2 + ay, top], null, 'tag');
  b.box([l - INSET, w / 2 - ay, top - lh], [l - o, w / 2 + ay, top], null, 'tag');
  const s = Math.min(0.5, 0.45 * Math.min(l, w));
  b.box([l / 2 - s / 2, w / 2 - s / 2, h - TAG], [l / 2 + s / 2, w / 2 + s / 2, h], null, 'tag');
  // Top edge protectors: outline every unit in its colour-mode colour when seen from above.
  const e = Math.min(0.05, 0.12 * Math.min(l, w));
  b.box([o, o, h - TAG], [l - o, o + e, h], null, 'tag');
  b.box([o, w - o - e, h - TAG], [l - o, w - o, h], null, 'tag');
  b.box([o, o + e, h - TAG], [o + e, w - o - e, h], null, 'tag');
  b.box([l - o - e, o + e, h - TAG], [l - o, w - o - e, h], null, 'tag');
}

/** Upright drum: a band around the upper body and a lid label. */
function drumTags({ b, r }: Ctx): void {
  const rad = Math.min(r.x1 - r.x0, r.y1 - r.y0) / 2;
  const hh = r.z1 - r.z0;
  const c = [b.l / 2, b.w / 2] as const;
  b.cylinder([c[0], c[1], r.z0 + hh * 0.72], rad + TAG * 0.8, hh * 0.16, 2, null, 'tag', 28);
  b.cylinder([c[0], c[1], b.h - TAG / 2], rad * 0.42, TAG, 2, null, 'tag', 24);
}

/** Lying roll / reel: coloured bands near both ends. */
function rollTags({ b }: Ctx): void {
  const rad = Math.min(b.w - 2 * INSET, b.h - TAG) / 2;
  const cz = rad + TAG / 2;
  for (const f of [0.14, 0.86]) b.cylinder([b.l * f, b.w / 2, cz], rad + TAG * 0.8, Math.min(0.12, b.l * 0.1), 0, null, 'tag', 32);
}

// ---------------------------------------------------------------------------------------------
// Grids of packages (cartons, crates, packs)
// ---------------------------------------------------------------------------------------------

interface GridOptions {
  target: readonly [number, number, number];
  maxCount?: number;
  body: (i: number, j: number, k: number) => Color;
  /** Decoration on outward faces: shipping label + barcode, a hand-hold slot, or a printed band. */
  decor?: 'label' | 'slot' | 'band' | 'none';
  decorColor?: string;
  tape?: string | null;
  /** Fill visible on top of the top layer (fruit, bottle caps); the body is then shorter. */
  topFill?: (i: number, j: number) => Color;
  topSpheres?: boolean;
}

function grid({ b, r }: Ctx, opt: GridOptions): void {
  const L = r.x1 - r.x0;
  const W = r.y1 - r.y0;
  const H = r.z1 - r.z0;
  if (L <= 0 || W <= 0 || H <= 0) return;
  const counts = [Math.max(1, Math.round(L / opt.target[0])), Math.max(1, Math.round(W / opt.target[1])), Math.max(1, Math.round(H / opt.target[2]))];
  const max = opt.maxCount ?? 48;
  while (counts[0] * counts[1] * counts[2] > max) {
    const i = counts.indexOf(Math.max(...counts));
    counts[i]--;
  }
  const [nx, ny, nz] = counts;
  const cw = L / nx;
  const cd = W / ny;
  const ch = H / nz;
  const g = Math.min(0.01, cw * 0.05, cd * 0.05);
  const cell = (i: number, j: number, k: number) => ({
    x0: r.x0 + i * cw + g / 2,
    x1: r.x0 + (i + 1) * cw - g / 2,
    y0: r.y0 + j * cd + g / 2,
    y1: r.y0 + (j + 1) * cd - g / 2,
    z0: r.z0 + k * ch,
    z1: r.z0 + (k + 1) * ch - g,
  });
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const c = cell(i, j, k);
        const fillTop = opt.topFill && k === nz - 1;
        const bodyTop = fillTop ? c.z1 - Math.min(0.06, ch * 0.25) : c.z1;
        b.box([c.x0, c.y0, c.z0], [c.x1, c.y1, bodyTop], opt.body(i, j, k));
        if (fillTop && opt.topFill) {
          const inset = Math.min(0.02, (c.x1 - c.x0) * 0.08);
          b.box([c.x0 + inset, c.y0 + inset, bodyTop], [c.x1 - inset, c.y1 - inset, c.z1 - 0.012], opt.topFill(i, j));
        }
      }
    }
  }
  if (opt.topFill && opt.topSpheres) {
    for (let i = 0; i < nx && b.room > 40; i++) {
      for (let j = 0; j < ny; j++) {
        const c = cell(i, j, nz - 1);
        const rad = Math.min(0.045, (c.x1 - c.x0) / 5, (c.y1 - c.y0) / 5);
        b.sphere([(c.x0 * 2 + c.x1) / 3, (c.y0 + c.y1) / 2, c.z1 - rad], rad, opt.topFill(i + 1, j + 3));
        b.sphere([(c.x0 + c.x1 * 2) / 3, (c.y0 * 2 + c.y1) / 3, c.z1 - rad], rad, opt.topFill(i + 2, j));
      }
    }
  }
  if (opt.tape) {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const c = cell(i, j, nz - 1);
        const tw = Math.min(0.05, (c.y1 - c.y0) * 0.16);
        const cy = (c.y0 + c.y1) / 2;
        b.box([c.x0, cy - tw / 2, c.z1], [c.x1, cy + tw / 2, c.z1 + 0.003], opt.tape);
      }
    }
  }
  const decor = opt.decor ?? 'none';
  if (decor === 'none') return;
  // Outward faces: the left side (y0) and the rear end (x1) of the unmoved item; labels every few layers to stay in budget.
  const perLayer = nx + ny;
  const partsPerDecor = decor === 'label' ? 2 : 1;
  const every = Math.max(1, Math.ceil((perLayer * nz * partsPerDecor) / Math.max(1, b.room - 4)));
  const t = 0.0025;
  for (let k = nz - 1; k >= 0; k -= every) {
    for (let i = 0; i < nx; i++) {
      const c = cell(i, 0, k);
      faceDecor(b, decor, opt.decorColor, 'y', c.y0, c.x0, c.x1, c.z0, c.z1, t);
    }
    for (let j = 0; j < ny; j++) {
      const c = cell(nx - 1, j, k);
      faceDecor(b, decor, opt.decorColor, 'x', c.x1, c.y0, c.y1, c.z0, c.z1, t);
    }
  }
}

/** Decoration on an outward face: at `plane` (y0 face when axis 'y', x1 face when axis 'x'), spanning [a0, a1] × [z0, z1]. */
function faceDecor(b: PartBuilder, decor: 'label' | 'slot' | 'band', color: string | undefined, axis: 'x' | 'y', plane: number, a0: number, a1: number, z0: number, z1: number, t: number): void {
  const span = a1 - a0;
  const hz = z1 - z0;
  const rect = (u0: number, u1: number, v0: number, v1: number, depth: number, c: string) => {
    if (axis === 'y') b.box([u0, plane - depth, v0], [u1, plane, v1], c);
    else b.box([plane, u0, v0], [plane + depth, u1, v1], c);
  };
  if (decor === 'label') {
    const lw = span * 0.42;
    const lh = Math.min(hz * 0.42, lw * 0.75);
    const u0 = a1 - span * 0.1 - lw;
    const v0 = z0 + hz * 0.22;
    rect(u0, u0 + lw, v0, v0 + lh, t, color ?? LABEL);
    rect(u0 + lw * 0.12, u0 + lw * 0.88, v0 + lh * 0.12, v0 + lh * 0.45, t + 0.0015, BARCODE);
  } else if (decor === 'slot') {
    const sw = span * 0.36;
    const u0 = (a0 + a1) / 2 - sw / 2;
    rect(u0, u0 + sw, z1 - hz * 0.32, z1 - hz * 0.16, t, '#26323a');
  } else {
    rect(a0 + span * 0.04, a1 - span * 0.04, z0 + hz * 0.35, z0 + hz * 0.62, t, color ?? '#d23c2f');
  }
}

/** Stretch-film hull around palletized goods (inside the item box, under the tags). */
function film({ b, r }: Ctx): void {
  const o = INSET * 0.5;
  b.box([o, o, r.z0 + 0.004], [b.l - o, b.w - o, b.h - TAG * 0.4], null, 'film');
}

// ---------------------------------------------------------------------------------------------
// Archetype builders
// ---------------------------------------------------------------------------------------------

const palette = (rnd: () => number, colors: readonly string[]): string => colors[Math.floor(rnd() * colors.length) % colors.length];

const BUILDERS: Record<GoodsArchetype, (ctx: Ctx) => void> = {
  'pallet-cartons': (ctx) => {
    const text = `${ctx.spec.name} ${ctx.spec.category}`.toLowerCase();
    const base = /pharma|medic/.test(text) ? '#eceef0' : /aerosol|spray/.test(text) ? '#d7d2c8' : KRAFT;
    grid(ctx, { target: [0.4, 0.3, 0.3], body: () => vary(base, ctx.rnd, 0.045, 0.02), decor: 'label', tape: '#d9b77e' });
    film(ctx);
  },
  'frozen-cartons': (ctx) => {
    grid(ctx, { target: [0.4, 0.3, 0.25], body: () => vary('#dde8f0', ctx.rnd, 0.03), decor: 'label', decorColor: '#ffffff', tape: '#2f6db5' });
    const { b, r } = ctx;
    const o = INSET * 0.5;
    // Frost-white wrap: an opaque cap of frosted film on top plus the transparent hull.
    b.box([r.x0, r.y0, r.z1 - 0.006], [r.x1, r.y1, r.z1 + 0.002], '#eef5fb');
    b.box([o, o, r.z0 + 0.004], [b.l - o, b.w - o, b.h - TAG * 0.4], null, 'film');
  },
  'dairy-crates': (ctx) => {
    const blue = '#2c6cb0';
    const white = '#eef1f4';
    grid(ctx, {
      target: [0.4, 0.3, 0.27],
      body: (_i, _j, k) => vary(k % 2 ? blue : white, ctx.rnd, 0.02),
      decor: 'slot',
      topFill: () => vary('#f8f8f6', ctx.rnd, 0.02),
    });
  },
  'produce-crates': (ctx) => {
    const fruit = ['#f08c00', '#e03131', '#fab005', '#82c91e', '#f76707'];
    grid(ctx, {
      target: [0.4, 0.3, 0.24],
      body: () => vary('#3f8f3a', ctx.rnd, 0.04),
      decor: 'slot',
      topFill: (i, j) => vary(fruit[(i * 3 + j) % fruit.length], ctx.rnd, 0.04),
      topSpheres: true,
    });
  },
  beverages: (ctx) => {
    const pack = palette(ctx.rnd, ['#2d6a4f', '#7a2e2e', '#1d4e89', '#5a3d2b']);
    grid(ctx, { target: [0.4, 0.27, 0.28], body: () => vary(pack, ctx.rnd, 0.03), decor: 'band', decorColor: '#f4d35e', topFill: () => vary('#d9dde1', ctx.rnd, 0.03) });
    film(ctx);
  },
  pails: (ctx) => {
    const text = `${ctx.spec.name} ${ctx.spec.category}`.toLowerCase();
    const body = /cleaner|corrosive|detergent/.test(text) ? '#2f6fd1' : '#eceef0';
    const lid = /chlorine|pool/.test(text) ? '#1f6fd1' : /paint|lacquer|coating/.test(text) ? '#c92a2a' : /cleaner|corrosive/.test(text) ? '#f1f3f5' : '#f08c00';
    cylinderGrid(ctx, { diameter: 0.3, height: 0.38, body, lid, rims: false, label: '#f8f9fa' });
    film(ctx);
  },
  batteries: (ctx) => {
    grid(ctx, { target: [0.4, 0.4, 0.35], body: () => vary('#34383d', ctx.rnd, 0.03), decor: 'label', tape: '#f2c200' });
    film(ctx);
  },
  'tv-boxes': (ctx) => {
    const { b, r } = ctx;
    const alongX = r.x1 - r.x0 >= r.y1 - r.y0;
    const span = alongX ? r.y1 - r.y0 : r.x1 - r.x0;
    const n = Math.max(1, Math.min(8, Math.round(span / 0.19)));
    const t = span / n;
    const gap = 0.008;
    for (let k = 0; k < n; k++) {
      const s0 = (alongX ? r.y0 : r.x0) + k * t + gap / 2;
      const s1 = s0 + t - gap;
      const box = alongX ? ([[r.x0, s0, r.z0], [r.x1, s1, r.z1]] as const) : ([[s0, r.y0, r.z0], [s1, r.y1, r.z1]] as const);
      b.box(box[0], box[1], vary('#f1f1ee', ctx.rnd, 0.015));
      // Printed brand stripe on the narrow edge facing out.
      if (alongX) b.box([r.x1, s0 + 0.01, r.z0 + 0.05], [r.x1 + 0.003, s1 - 0.01, r.z1 - 0.05], '#1f5fbf');
      else b.box([s0 + 0.01, r.y0 - 0.003, r.z0 + 0.05], [s1 - 0.01, r.y0, r.z1 - 0.05], '#1f5fbf');
    }
    // Screen artwork on the two large outer faces.
    const hz = r.z1 - r.z0;
    for (const side of [0, 1]) {
      if (alongX) {
        const y = side ? r.y1 - gap / 2 : r.y0 + gap / 2;
        const d = side ? 0.003 : -0.003;
        const lo = Math.min(y, y + d);
        const hi = Math.max(y, y + d);
        b.box([r.x0 + 0.08, lo, r.z0 + hz * 0.32], [r.x1 - 0.08, hi, r.z1 - hz * 0.12], '#1c2a3a');
        b.box([r.x0 + 0.14, Math.min(y + d, y + 2 * d), r.z0 + hz * 0.4], [r.x1 - 0.14, Math.max(y + d, y + 2 * d), r.z1 - hz * 0.2], '#3d86d8');
      } else {
        const x = side ? r.x1 - gap / 2 : r.x0 + gap / 2;
        const d = side ? 0.003 : -0.003;
        b.box([Math.min(x, x + d), r.y0 + 0.08, r.z0 + hz * 0.32], [Math.max(x, x + d), r.y1 - 0.08, r.z1 - hz * 0.12], '#1c2a3a');
        b.box([Math.min(x + d, x + 2 * d), r.y0 + 0.14, r.z0 + hz * 0.4], [Math.max(x + d, x + 2 * d), r.y1 - 0.14, r.z1 - hz * 0.2], '#3d86d8');
      }
    }
  },
  'wooden-crate': (ctx) => woodenCrate(ctx, { wood: '#b88b55', plankHeight: 0.15, core: '#5e4630' }),
  'glass-crate': (ctx) => {
    woodenCrate(ctx, { wood: '#d6b98a', plankHeight: 0.3, core: '#8fc1d6' });
    const { b, r } = ctx;
    const hz = r.z1 - r.z0;
    for (const y of [r.y0 - 0.004, r.y1]) {
      b.box([r.x0 + 0.12, y, r.z0 + hz * 0.55], [r.x1 - 0.12, y + 0.004, r.z0 + hz * 0.64], '#d62828');
    }
  },
  machine: machine,
  'steel-bundle': (ctx) => {
    const { b, r, rnd } = ctx;
    const bearer = Math.min(0.05, (r.z1 - r.z0) * 0.18);
    const nb = Math.max(2, Math.min(4, Math.round((r.x1 - r.x0) / 1.4) + 1));
    for (let i = 0; i < nb; i++) {
      const x = r.x0 + 0.1 + (i * (r.x1 - r.x0 - 0.28)) / (nb - 1);
      b.box([x, r.y0, r.z0], [x + 0.08, r.y1, r.z0 + bearer], vary(WOOD_DARK, rnd, 0.05));
    }
    const s = 0.006;
    const y0 = r.y0 + s;
    const y1 = r.y1 - s;
    const z0 = r.z0 + bearer;
    const z1 = r.z1 - s;
    const ny = Math.max(1, Math.min(8, Math.round((y1 - y0) / 0.08)));
    const nz = Math.max(1, Math.min(6, Math.round((z1 - z0) / 0.08)));
    const by = (y1 - y0) / ny;
    const bz = (z1 - z0) / nz;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        const stagger = rnd() * 0.04;
        b.box([r.x0 + stagger, y0 + j * by + 0.003, z0 + k * bz], [r.x1 - (0.04 - stagger), y0 + (j + 1) * by - 0.003, z0 + (k + 1) * bz - 0.004], vary(STEEL, rnd, 0.06));
      }
    }
    const strap = '#2463c4';
    const ns = Math.max(2, Math.min(4, Math.round((r.x1 - r.x0) / 1.3)));
    for (let i = 0; i < ns; i++) {
      const x = r.x0 + ((i + 0.5) * (r.x1 - r.x0)) / ns;
      b.box([x - 0.018, r.y0, z1], [x + 0.018, r.y1, r.z1], strap);
      b.box([x - 0.018, r.y0, z0], [x + 0.018, y0, r.z1], strap);
      b.box([x - 0.018, y1, z0], [x + 0.018, r.y1, r.z1], strap);
    }
  },
  drum: (ctx) => {
    const text = `${ctx.spec.name} ${ctx.spec.category}`.toLowerCase();
    const body = ctx.spec.hazmat?.hazClass === '3' ? '#c0392b' : /oil|lubric/.test(text) ? '#1f4e9a' : palette(ctx.rnd, ['#2f6aa3', '#2b8a3e', '#495057']);
    if (ctx.spec.shape === 'cylinder-upright') singleDrum(ctx, body);
    else {
      cylinderGrid(ctx, { diameter: 0.585, height: 0.88, body, lid: '#2b2f33', rims: true });
      film(ctx);
    }
  },
  'paper-roll': (ctx) => {
    const { b, rnd } = ctx;
    const rad = Math.min(b.w - 2 * INSET, b.h - TAG) / 2;
    const cy = b.w / 2;
    const cz = rad + TAG / 2;
    b.cylinder([b.l / 2, cy, cz], rad * 0.985, b.l - 0.02, 0, vary('#ece6d8', rnd, 0.02), 'solid', 40);
    b.cylinder([b.l / 2, cy, cz], rad * 0.2, b.l - 0.01, 0, '#8b6b43', 'solid', 20);
    b.cylinder([b.l / 2, cy, cz], rad * 0.13, b.l, 0, '#2b2620', 'solid', 16);
    b.cylinder([b.l / 2, cy, cz], rad * 1.0, Math.min(0.5, b.l * 0.3), 0, '#d9cdb4', 'solid', 40);
  },
  'cable-reel': (ctx) => {
    const { b, rnd } = ctx;
    const rad = Math.min(b.w - 2 * INSET, b.h - TAG) / 2;
    const cy = b.w / 2;
    const cz = rad + TAG / 2;
    const ft = Math.min(0.06, b.l * 0.08);
    for (const x of [0.004 + ft / 2, b.l - 0.004 - ft / 2]) b.cylinder([x, cy, cz], rad, ft, 0, vary('#b98d58', rnd, 0.04), 'solid', 36);
    b.cylinder([b.l / 2, cy, cz], rad * 0.78, b.l - 2 * ft - 0.008, 0, '#232527', 'solid', 32);
    b.cylinder([b.l / 2, cy, cz], rad * 0.14, b.l, 0, STEEL, 'solid', 16);
    b.cylinder([b.l / 2, cy, cz], rad * 0.07, b.l, 0, DARK_STEEL, 'solid', 12);
  },
  ibc: (ctx) => {
    const { b, r } = ctx;
    const pb = r.z0 > 0 ? 0 : Math.min(0.15, (r.z1 - r.z0) * 0.13);
    if (pb > 0) {
      for (const y of [r.y0, (r.y0 + r.y1) / 2 - 0.05, r.y1 - 0.1]) b.box([r.x0, y, 0], [r.x1, y + 0.1, pb - 0.03], '#5f656c');
      b.box([r.x0, r.y0, pb - 0.03], [r.x1, r.y1, pb], '#6b7178');
    }
    const z0 = r.z0 + pb;
    const bar = 0.022;
    b.box([r.x0 + 0.04, r.y0 + 0.04, z0], [r.x1 - 0.04, r.y1 - 0.04, r.z1 - 0.07], '#eef0e8');
    b.cylinder([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, r.z1 - 0.045], 0.11, 0.05, 2, '#f5f5f2', 'solid', 20);
    b.cylinder([r.x1 - 0.02, (r.y0 + r.y1) / 2, z0 + 0.09], 0.04, 0.05, 0, '#2b2f33', 'solid', 12);
    const cage = '#a9afb6';
    for (const [x, y] of [[r.x0, r.y0], [r.x1 - bar, r.y0], [r.x0, r.y1 - bar], [r.x1 - bar, r.y1 - bar]] as const) b.box([x, y, z0], [x + bar, y + bar, r.z1], cage);
    const levels = 3;
    for (let k = 1; k <= levels; k++) {
      const z = z0 + (k * (r.z1 - z0)) / levels - bar;
      b.box([r.x0, r.y0, z], [r.x1, r.y0 + bar, z + bar], cage);
      b.box([r.x0, r.y1 - bar, z], [r.x1, r.y1, z + bar], cage);
      b.box([r.x0, r.y0, z], [r.x0 + bar, r.y1, z + bar], cage);
      b.box([r.x1 - bar, r.y0, z], [r.x1, r.y1, z + bar], cage);
    }
    for (const f of [0.25, 0.5, 0.75]) {
      const x = r.x0 + (r.x1 - r.x0) * f;
      b.box([x - bar / 2, r.y0, z0], [x + bar / 2, r.y0 + bar, r.z1], cage);
      b.box([x - bar / 2, r.y1 - bar, z0], [x + bar / 2, r.y1, r.z1], cage);
      const y = r.y0 + (r.y1 - r.y0) * f;
      b.box([r.x0, y - bar / 2, z0], [r.x0 + bar, y + bar / 2, r.z1], cage);
      b.box([r.x1 - bar, y - bar / 2, z0], [r.x1, y + bar / 2, r.z1], cage);
    }
  },
  bricks: (ctx) => {
    const { b, r, rnd } = ctx;
    const lh = 0.075;
    const nz = Math.max(1, Math.min(16, Math.floor((r.z1 - r.z0) / lh)));
    const layer = (r.z1 - r.z0) / nz;
    const g = 0.006;
    for (let k = 0; k < nz; k++) {
      const z0 = r.z0 + k * layer;
      const z1 = z0 + layer - g;
      if (k % 2 === 0) {
        const n = 4;
        const s = (r.x1 - r.x0) / n;
        for (let i = 0; i < n; i++) b.box([r.x0 + i * s + g / 2, r.y0, z0], [r.x0 + (i + 1) * s - g / 2, r.y1, z1], vary('#b4532e', rnd, 0.06, 0.02));
      } else {
        const n = 3;
        const s = (r.y1 - r.y0) / n;
        for (let j = 0; j < n; j++) b.box([r.x0, r.y0 + j * s + g / 2, z0], [r.x1, r.y0 + (j + 1) * s - g / 2, z1], vary('#a9492a', rnd, 0.06, 0.02));
      }
    }
    for (const f of [0.3, 0.7]) {
      const x = r.x0 + (r.x1 - r.x0) * f;
      b.box([x - 0.012, r.y0 - 0.003, r.z0], [x + 0.012, r.y0, r.z1], DARK_STEEL);
      b.box([x - 0.012, r.y1, r.z0], [x + 0.012, r.y1 + 0.003, r.z1], DARK_STEEL);
      b.box([x - 0.012, r.y0, r.z1], [x + 0.012, r.y1, r.z1 + 0.003], DARK_STEEL);
    }
  },
  furniture: (ctx) => {
    const { r } = ctx;
    grid(ctx, {
      target: [r.x1 - r.x0, r.y1 - r.y0, 0.14],
      maxCount: 12,
      body: () => vary('#d3ae78', ctx.rnd, 0.035),
      decor: 'band',
      decorColor: palette(ctx.rnd, ['#1f5fa8', '#2b2b2b', '#c2410c']),
      tape: '#c9a46b',
    });
  },
  carton: (ctx) => {
    const { b, r, rnd } = ctx;
    b.box([r.x0, r.y0, r.z0], [r.x1, r.y1, r.z1], vary(KRAFT, rnd, 0.03));
    const cy = (r.y0 + r.y1) / 2;
    const tw = Math.min(0.05, (r.y1 - r.y0) * 0.15);
    b.box([r.x0, cy - tw / 2, r.z1], [r.x1, cy + tw / 2, r.z1 + 0.003], '#d9b77e');
    for (const x of [r.x0 - 0.003, r.x1]) b.box([x, cy - tw / 2, r.z1 - (r.z1 - r.z0) * 0.3], [x + 0.003, cy + tw / 2, r.z1], '#d9b77e');
    faceDecor(b, 'label', undefined, 'y', r.y0, r.x0, r.x1, r.z0, r.z1, 0.0025);
    const hz = r.z1 - r.z0;
    for (const f of [0.35, 0.65]) {
      const x = r.x0 + (r.x1 - r.x0) * f;
      b.box([x - 0.012, r.y0 - 0.002, r.z1 - hz * 0.3], [x + 0.012, r.y0, r.z1 - hz * 0.08], BARCODE);
    }
  },
  custom: (ctx) => {
    const { b, r, rnd } = ctx;
    b.box([r.x0, r.y0, r.z0], [r.x1, r.y1, r.z1], vary('#a3acb5', rnd, 0.03));
    const t = Math.min(0.03, (r.x1 - r.x0) * 0.08, (r.y1 - r.y0) * 0.08);
    for (const [x, y] of [[r.x0, r.y0], [r.x1 - t, r.y0], [r.x0, r.y1 - t], [r.x1 - t, r.y1 - t]] as const) b.box([x - 0.003, y - 0.003, r.z0], [x + t, y + t, r.z1], '#6c757d');
    faceDecor(b, 'label', undefined, 'y', r.y0, r.x0, r.x1, r.z0, r.z1, 0.004);
  },
};

function woodenCrate({ b, r, rnd }: Ctx, o: { wood: string; plankHeight: number; core: string }): void {
  const pt = Math.min(0.022, (r.x1 - r.x0) * 0.05, (r.y1 - r.y0) * 0.05);
  const sk = Math.min(0.1, (r.z1 - r.z0) * 0.12);
  for (const f of [0.08, 0.5, 0.92]) {
    const y = r.y0 + (r.y1 - r.y0) * f;
    b.box([r.x0, y - 0.045, r.z0], [r.x1, y + 0.045, r.z0 + sk], vary(WOOD_DARK, rnd, 0.05));
  }
  const z0 = r.z0 + sk;
  const z1 = r.z1;
  b.box([r.x0 + pt * 1.5, r.y0 + pt * 1.5, z0], [r.x1 - pt * 1.5, r.y1 - pt * 1.5, z1 - pt], o.core);
  const n = Math.max(2, Math.min(8, Math.round((z1 - z0) / o.plankHeight)));
  const ph = (z1 - z0 - pt) / n;
  const gap = Math.min(0.015, ph * 0.12);
  const plank = () => vary(o.wood, rnd, 0.06, 0.02);
  for (let k = 0; k < n; k++) {
    const a = z0 + k * ph;
    const c = a + ph - gap;
    b.box([r.x0 + pt, r.y0 + pt * 0.5, a], [r.x1 - pt, r.y0 + pt * 1.5, c], plank());
    b.box([r.x0 + pt, r.y1 - pt * 1.5, a], [r.x1 - pt, r.y1 - pt * 0.5, c], plank());
    b.box([r.x0 + pt * 0.5, r.y0 + pt, a], [r.x0 + pt * 1.5, r.y1 - pt, c], plank());
    b.box([r.x1 - pt * 1.5, r.y0 + pt, a], [r.x1 - pt * 0.5, r.y1 - pt, c], plank());
  }
  const m = Math.max(2, Math.min(8, Math.round((r.y1 - r.y0) / 0.16)));
  const tw = (r.y1 - r.y0) / m;
  for (let j = 0; j < m; j++) b.box([r.x0, r.y0 + j * tw + gap / 2, z1 - pt], [r.x1, r.y0 + (j + 1) * tw - gap / 2, z1], plank());
  const batten = () => vary(WOOD_DARK, rnd, 0.04);
  const bw = Math.min(0.08, (r.x1 - r.x0) * 0.1);
  const mid = (r.x0 + r.x1) / 2;
  for (const [y0, y1] of [[r.y0, r.y0 + pt * 0.5], [r.y1 - pt * 0.5, r.y1]] as const) {
    for (const x of [r.x0, mid - bw / 2, r.x1 - bw]) b.box([x, y0, z0], [x + bw, y1, z1 - pt], batten());
    b.box([r.x0, y0, z0], [r.x1, y1, z0 + bw], batten());
    b.box([r.x0, y0, z1 - pt - bw], [r.x1, y1, z1 - pt], batten());
  }
  const bwy = Math.min(0.08, (r.y1 - r.y0) * 0.12);
  for (const [x0, x1] of [[r.x0, r.x0 + pt * 0.5], [r.x1 - pt * 0.5, r.x1]] as const) {
    for (const y of [r.y0, r.y1 - bwy]) b.box([x0, y, z0], [x1, y + bwy, z1 - pt], batten());
    b.box([x0, r.y0, z0], [x1, r.y1, z0 + bwy], batten());
    b.box([x0, r.y0, z1 - pt - bwy], [x1, r.y1, z1 - pt], batten());
  }
}

function machine({ b, r, rnd, spec }: Ctx): void {
  const L = r.x1 - r.x0;
  const W = r.y1 - r.y0;
  const sk = Math.min(0.12, (r.z1 - r.z0) * 0.1);
  for (const f of [0.12, 0.88]) {
    const y = r.y0 + W * f;
    b.box([r.x0, y - 0.05, r.z0], [r.x1, y + 0.05, r.z0 + sk - 0.03], vary(WOOD_DARK, rnd, 0.05));
  }
  for (let i = 0; i < 5; i++) {
    const x = r.x0 + (i * (L - 0.12)) / 4;
    b.box([x, r.y0, r.z0 + sk - 0.03], [x + 0.12, r.y1, r.z0 + sk], vary(WOOD, rnd, 0.05));
  }
  const zb = r.z0 + sk;
  const H = r.z1 - zb;
  b.box([r.x0 + 0.04, r.y0 + 0.06, zb], [r.x1 - 0.04, r.y1 - 0.06, zb + H * 0.12], DARK_STEEL);
  const heavyRear = spec.cogOffset.x >= 0;
  const bodyColor = palette(rnd, ['#3b6ea5', '#4f7d4a', '#d6dade']);
  const z2 = zb + H * 0.12;
  // Light end: machine body with control box and spindle; heavy end: big motor and gearbox.
  const bodyLen = L * 0.52;
  const bx0 = heavyRear ? r.x0 + 0.06 : r.x1 - 0.06 - bodyLen;
  const bx1 = bx0 + bodyLen;
  b.box([bx0, r.y0 + 0.1, z2], [bx1, r.y1 - 0.1, z2 + H * 0.62], bodyColor);
  b.box([bx0 + 0.03, r.y0 + 0.1 - 0.004, z2 + H * 0.3], [bx1 - 0.03, r.y0 + 0.1, z2 + H * 0.55], '#a9cbe0');
  b.box([bx0 + bodyLen * 0.25, r.y0 + 0.14, z2 + H * 0.62], [bx0 + bodyLen * 0.7, r.y0 + 0.14 + W * 0.3, z2 + H * 0.86], '#e9ecef');
  b.box([bx0 + bodyLen * 0.3, r.y0 + 0.136, z2 + H * 0.68], [bx0 + bodyLen * 0.62, r.y0 + 0.14, z2 + H * 0.8], '#1c2a3a');
  const spX = heavyRear ? bx0 - 0.02 : bx1 + 0.02;
  b.cylinder([heavyRear ? r.x0 + 0.05 : r.x1 - 0.05, (r.y0 + r.y1) / 2, z2 + H * 0.38], Math.min(0.09, W * 0.1), 0.1, 0, STEEL, 'solid', 16);
  b.cylinder([spX, (r.y0 + r.y1) / 2, z2 + H * 0.38], Math.min(0.12, W * 0.13), 0.06, 0, DARK_STEEL, 'solid', 16);
  // Colour-mode tags: a band around the skid and plates on both sides and the top of the body.
  b.box([r.x0, r.y0 - TAG, r.z0], [r.x1, r.y0, r.z0 + sk], null, 'tag');
  b.box([r.x0, r.y1, r.z0], [r.x1, r.y1 + TAG, r.z0 + sk], null, 'tag');
  b.box([r.x0 - TAG, r.y0, r.z0], [r.x0, r.y1, r.z0 + sk], null, 'tag');
  b.box([r.x1, r.y0, r.z0], [r.x1 + TAG, r.y1, r.z0 + sk], null, 'tag');
  b.box([bx0 + 0.05, r.y0 + 0.1 - TAG, z2 + H * 0.06], [bx1 - 0.05, r.y0 + 0.1, z2 + H * 0.26], null, 'tag');
  b.box([bx0 + 0.05, r.y1 - 0.1, z2 + H * 0.06], [bx1 - 0.05, r.y1 - 0.1 + TAG, z2 + H * 0.26], null, 'tag');
  b.box([bx0 + 0.04, r.y1 - 0.1 - W * 0.35, z2 + H * 0.62], [bx1 - 0.04, r.y1 - 0.14, z2 + H * 0.62 + TAG], null, 'tag');
  const motorLen = L * 0.36;
  const mx = heavyRear ? r.x1 - 0.06 - motorLen / 2 : r.x0 + 0.06 + motorLen / 2;
  const mr = Math.min((W - 0.2) / 2, H * 0.3);
  const mz = z2 + mr + 0.02;
  b.box([mx - motorLen * 0.4, (r.y0 + r.y1) / 2 - mr * 0.8, z2], [mx + motorLen * 0.4, (r.y0 + r.y1) / 2 + mr * 0.8, z2 + 0.06], DARK_STEEL);
  b.cylinder([mx, (r.y0 + r.y1) / 2, mz], mr, motorLen, 0, '#2f3338', 'solid', 28);
  for (const f of [-0.3, -0.1, 0.1, 0.3]) b.cylinder([mx + motorLen * f, (r.y0 + r.y1) / 2, mz], mr * 1.06, 0.02, 0, '#43484e', 'solid', 28);
  b.box([mx - motorLen * 0.15, (r.y0 + r.y1) / 2 - mr * 0.4, mz + mr * 0.85], [mx + motorLen * 0.15, (r.y0 + r.y1) / 2 + mr * 0.4, mz + mr * 1.15], '#6c757d');
}

function singleDrum({ b, r }: Ctx, body: string): void {
  const rad = Math.min(r.x1 - r.x0, r.y1 - r.y0) / 2;
  const cx = b.l / 2;
  const cy = b.w / 2;
  const h = r.z1 - r.z0;
  b.cylinder([cx, cy, r.z0 + h / 2], rad * 0.96, h - 0.01, 2, body, 'solid', 32);
  for (const f of [0.012, 0.33, 0.67, 0.988]) b.cylinder([cx, cy, r.z0 + h * f], rad, 0.02, 2, new Color(body).multiplyScalar(0.7), 'solid', 32);
  b.cylinder([cx, cy, r.z1 - 0.004], rad * 0.9, 0.008, 2, new Color(body).multiplyScalar(0.8), 'solid', 32);
  b.cylinder([cx + rad * 0.55, cy, r.z1 + 0.004], rad * 0.09, 0.016, 2, '#ced4da', 'solid', 12);
  b.cylinder([cx - rad * 0.55, cy, r.z1 + 0.004], rad * 0.06, 0.016, 2, '#ced4da', 'solid', 12);
}

function cylinderGrid({ b, r }: Ctx, o: { diameter: number; height: number; body: string; lid: string; rims: boolean; label?: string }): void {
  const L = r.x1 - r.x0;
  const W = r.y1 - r.y0;
  const H = r.z1 - r.z0;
  const nx = Math.max(1, Math.round(L / o.diameter));
  const ny = Math.max(1, Math.round(W / o.diameter));
  const nz = Math.max(1, Math.min(4, Math.round(H / o.height)));
  const perLayerParts = o.rims ? 3 : o.label ? 3 : 2;
  const layers = Math.max(1, Math.min(nz, Math.floor((b.room - 4) / (nx * ny * perLayerParts))));
  const cw = L / nx;
  const cd = W / ny;
  const lh = H / layers;
  const rad = Math.min(cw, cd) / 2 - 0.006;
  for (let k = 0; k < layers; k++) {
    const z0 = r.z0 + k * lh;
    const bh = lh - 0.012;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const cx = r.x0 + (i + 0.5) * cw;
        const cy = r.y0 + (j + 0.5) * cd;
        // Pails taper slightly: model as a body plus a wider lid ring.
        b.cylinder([cx, cy, z0 + bh / 2], rad * 0.92, bh, 2, o.body, 'solid', 20);
        b.cylinder([cx, cy, z0 + bh - 0.012], rad, 0.024, 2, o.lid, 'solid', 20);
        if (o.rims) b.cylinder([cx, cy, z0 + bh * 0.5], rad * 0.97, 0.02, 2, new Color(o.body).multiplyScalar(0.7), 'solid', 20);
        else if (o.label) b.cylinder([cx, cy, z0 + bh * 0.45], rad * 0.935, bh * 0.35, 2, o.label, 'solid', 20);
      }
    }
  }
}
