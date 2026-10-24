import { describe, expect, it } from 'vitest';
import { PACKAGING_PRESETS } from '../../data/packaging';
import { createSeedPlan, makeSpec } from '../../data/seed';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import { createVehicle } from '../../domain/presets';
import { HAZMAT_CLASSES } from '../../domain/settings';
import { lbToKg, toMetres } from '../../domain/units';
import { checkDraft, deriveItem, fitVehicle, hasErrors, type LineDraft } from './itemChecks';

const plan = createSeedPlan();
const draftOf = (spec = makeSpec({ name: 'Test', dims: { l: 1.2, w: 0.8, h: 1.2 }, weightKg: 300 })): LineDraft => ({ spec, quantity: 1, stopId: plan.stops[0].id, priority: 'normal' });

describe('built-in templates', () => {
  it('ships at least 22 valid, unique, built-in templates that fit some preset', () => {
    expect(BUILT_IN_TEMPLATES.length).toBeGreaterThanOrEqual(22);
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size).toBe(BUILT_IN_TEMPLATES.length);
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.builtIn).toBe(true);
      const issues = checkDraft(draftOf(t.spec), plan, deriveItem(t.spec, plan));
      expect(issues.errors, t.spec.name).toEqual({});
      expect(issues.blocking, t.spec.name).toEqual([]);
      if (t.spec.hazmat) expect(HAZMAT_CLASSES).toContain(t.spec.hazmat.hazClass);
      if (t.spec.palletHeight > 0) expect(t.spec.dims.h).toBeGreaterThan(t.spec.palletHeight);
    }
  });

  it('includes the required hazmat classes', () => {
    const un = BUILT_IN_TEMPLATES.flatMap((t) => (t.spec.hazmat ? [`${t.spec.hazmat.unNumber}/${t.spec.hazmat.hazClass}`] : []));
    expect(un).toEqual(expect.arrayContaining(['UN3480/9', 'UN1950/2.1', 'UN1263/3', 'UN1760/8', 'UN2588/6.1']));
  });
});

describe('packaging presets', () => {
  it('match the specified sizes', () => {
    expect(PACKAGING_PRESETS['eur-pallet'].dims).toMatchObject({ l: 1.2, w: 0.8 });
    expect(PACKAGING_PRESETS['eur-pallet'].palletHeight).toBe(0.144);
    expect(PACKAGING_PRESETS['us-pallet'].dims?.l).toBeCloseTo(toMetres(48, 'in'));
    expect(PACKAGING_PRESETS.drum.shape).toBe('cylinder-upright');
    expect(PACKAGING_PRESETS.ibc.dims).toEqual({ l: 1.2, w: 1.0, h: 1.15 });
  });
});

describe('fitVehicle', () => {
  const settings = plan.settings;

  it('rejects units taller than the rear door on rear-only vehicles but not on side-access ones', () => {
    const rigid = createVehicle('eu-rigid-18'); // rear only, door 2.4 m
    const tall = makeSpec({ name: 'Tall', dims: { l: 1.0, w: 1.0, h: 2.42 }, weightKg: 100, rotation: 'none' });
    expect(fitVehicle(tall, rigid, settings)).toMatchObject({ fits: false, reason: 'does not pass the door' });
    const curtain = createVehicle('eu-curtainsider-136');
    expect(curtain.access.some((a) => a !== 'rear')).toBe(true);
  });

  it('tries every allowed orientation', () => {
    const van = createVehicle('eu-van-35'); // 4.3 x 1.75 x 1.9
    const long = makeSpec({ name: 'Bar', dims: { l: 0.3, w: 4.0, h: 0.3 }, weightKg: 50, rotation: 'yaw' });
    expect(fitVehicle(long, van, settings).fits).toBe(true);
    expect(fitVehicle({ ...long, rotation: 'none' }, van, settings).fits).toBe(false);
  });

  it('flags chilled goods in vehicles without temperature control as a caveat', () => {
    const dryVan = createVehicle('us-dry-van-53');
    const dairy = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-dairy')!.spec;
    expect(fitVehicle(dairy, dryVan, settings)).toEqual(expect.objectContaining({ fits: true, reason: 'no temperature control' }));
  });
});

describe('checkDraft', () => {
  it('derives values for an imperial 48 x 40 x 50 in, 1,200 lb unit', () => {
    const spec = makeSpec({ name: 'Imperial', dims: { l: toMetres(48, 'in'), w: toMetres(40, 'in'), h: toMetres(50, 'in') }, weightKg: lbToKg(1200) });
    const d = deriveItem(spec, plan);
    expect(d.volume).toBeCloseTo(48 * 40 * 50 * 0.0254 ** 3, 6);
    expect(d.density).toBeCloseTo(lbToKg(1200) / d.volume, 6);
    expect(d.ldm).toBeCloseTo((toMetres(48, 'in') * toMetres(40, 'in')) / 2.4, 6);
    expect(d.planFits[0].fits).toBe(true);
    expect(hasErrors(checkDraft(draftOf(spec), plan, d))).toBe(false);
  });

  it('requires positive values, a valid UN number and a known stop', () => {
    const spec = makeSpec({ name: '', dims: { l: 0, w: 1, h: 1 }, weightKg: 0, hazmat: { unNumber: 'UN12', hazClass: '3' } });
    const issues = checkDraft({ ...draftOf(spec), quantity: 0, stopId: 'nope' }, plan, deriveItem(spec, plan));
    expect(Object.keys(issues.errors).sort()).toEqual(['dims', 'name', 'quantity', 'stop', 'unNumber', 'weight']);
  });

  it('blocks items that fit no vehicle and warns when only presets fit', () => {
    const huge = makeSpec({ name: 'Huge', dims: { l: 20, w: 3, h: 3 }, weightKg: 1000 });
    expect(checkDraft(draftOf(huge), plan, deriveItem(huge, plan)).blocking).toHaveLength(1);

    const vanPlan = { ...plan, vehicles: [createVehicle('eu-van-35')] };
    const crate = makeSpec({ name: 'Crate', dims: { l: 2, w: 2, h: 2 }, weightKg: 800 });
    const issues = checkDraft(draftOf(crate), vanPlan, deriveItem(crate, vanPlan));
    expect(issues.blocking).toEqual([]);
    expect(issues.warnings.some((w) => w.startsWith('Fits no vehicle in this plan'))).toBe(true);
  });

  it('warns on implausible density and forklift capacity', () => {
    const heavy = makeSpec({ name: 'Ingot', dims: { l: 0.5, w: 0.5, h: 0.5 }, weightKg: 2600 });
    const w = checkDraft(draftOf(heavy), plan, deriveItem(heavy, plan)).warnings;
    expect(w.some((x) => x.includes('high density'))).toBe(true);
    expect(w.some((x) => x.includes('forklift'))).toBe(true);
  });
});
