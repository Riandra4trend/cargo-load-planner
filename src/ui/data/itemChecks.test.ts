import { describe, expect, it } from 'vitest';
import { PACKAGING_PRESETS } from '../../data/packaging';
import { createSeedPlan, createTankerSeedPlan, createTipperSeedPlan, makeBulkSpec, makeSpec } from '../../data/seed';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import { materialDef } from '../../domain/materials';
import { createVehicle } from '../../domain/presets';
import { HAZMAT_CLASSES } from '../../domain/settings';
import type { ItemSpec, Plan } from '../../domain/types';
import { lbToKg, toMetres } from '../../domain/units';
import { bestLegalFill, checkDraft, containerCapacityL, deriveItem, fitVehicle, hasErrors, materialTareKg, splitAdvice, splitLegalLoads, type LineDraft } from './itemChecks';

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

describe('liquids', () => {
  const tankerPlan = createTankerSeedPlan();
  const settings = tankerPlan.settings;
  const tpl = (id: string) => BUILT_IN_TEMPLATES.find((t) => t.id === `tpl-${id}`)!.spec;
  const issuesOf = (spec: ItemSpec, p: Plan = tankerPlan) => checkDraft({ spec, quantity: 1, stopId: p.stops[0].id, priority: 'normal' }, p, deriveItem(spec, p));

  it('derives template weights from volume × density + container', () => {
    expect(tpl('diesel-drum').weightKg).toBeCloseTo(200 * 0.84 + PACKAGING_PRESETS.drum.tareKg, 6);
    expect(materialTareKg(tpl('diesel-drum'))).toBeCloseTo(PACKAGING_PRESETS.drum.tareKg, 6);
    expect(tpl('sulfuric-ibc').weightKg).toBeCloseTo(1000 * 1.84 + PACKAGING_PRESETS.ibc.tareKg, 6);
    expect(tpl('gasoline-bulk').weightKg).toBeCloseTo(5800 * 0.74, 6);
    expect(tpl('sulfuric-ibc').hazmat).toMatchObject({ unNumber: 'UN1830', hazClass: '8' });
    expect(tpl('diesel-drum').hazmat?.unNumber).toBe('UN1202');
    const liquids = BUILT_IN_TEMPLATES.filter((t) => t.spec.material?.state === 'liquid');
    expect(liquids.length).toBeGreaterThanOrEqual(12);
    for (const t of liquids) expect(t.spec.weightKg, t.spec.name).toBeGreaterThanOrEqual(t.spec.material!.volumeL * t.spec.material!.densityKgPerL - 1e-9);
  });

  it('lists the compartments that hold a bulk fill at its max fill', () => {
    const semi = createVehicle('tanker-semi-32k');
    expect(fitVehicle(makeBulkSpec('gasoline', 5800), semi, settings)).toMatchObject({ fits: true, detail: 'C1, C2, C3, C4, C5' });
    expect(fitVehicle(makeBulkSpec('diesel', 7700), semi, settings)).toMatchObject({ fits: true, detail: 'C1' });
    expect(fitVehicle(makeBulkSpec('diesel', 7800), semi, settings).fits).toBe(false);
  });

  it('requires food-grade, insulated and pressurised tanks where needed', () => {
    const milk = makeBulkSpec('milk', 7800);
    expect(fitVehicle(milk, createVehicle('tanker-semi-32k'), settings).reason).toBe('needs a food-grade tank');
    expect(fitVehicle(milk, createVehicle('tanker-water-8k'), settings).reason).toBe('needs an insulated tank');
    expect(fitVehicle(milk, createVehicle('tanker-food-24k'), settings).fits).toBe(true);
    const lpg = makeBulkSpec('lpg', 20000);
    expect(fitVehicle(lpg, createVehicle('tanker-semi-32k'), settings).reason).toBe('needs a pressurised tank');
    expect(fitVehicle(lpg, createVehicle('tanker-lpg-44k'), settings).fits).toBe(true);
    expect(fitVehicle(makeBulkSpec('diesel', 5000), createVehicle('tanker-lpg-44k'), settings).fits).toBe(false);
    expect(fitVehicle(tpl('diesel-drum'), createVehicle('tanker-semi-32k'), settings).fits).toBe(false);
  });

  it('only compares bulk fills with tankers and packaged units with the other vehicles', () => {
    const d = deriveItem(makeBulkSpec('water', 7800), plan);
    expect(d.planFits).toEqual([]);
    expect(d.presetFits.every((f) => f.name.toLowerCase().includes('tanker'))).toBe(true);
    expect(deriveItem(tpl('water-ibc'), tankerPlan).planFits).toEqual([]);
  });

  it('warns about the tank type when no plan tanker fits and blocks fills no tanker can hold', () => {
    expect(issuesOf(makeBulkSpec('milk', 7800)).warnings).toContain('Needs a food-grade tank');
    expect(issuesOf(makeBulkSpec('lpg', 20000)).warnings).toContain('Needs a pressurised tank');
    expect(issuesOf(makeBulkSpec('diesel', 9000)).blocking).toHaveLength(1);
    expect(issuesOf(makeBulkSpec('gasoline', 5800))).toEqual({ errors: {}, blocking: [], warnings: [] });
    expect(issuesOf(makeBulkSpec('water', 7800), plan).warnings[0]).toMatch(/^Needs a tanker/);
  });

  it('checks density, volume and container capacity', () => {
    const drum = tpl('diesel-drum');
    expect(containerCapacityL(drum)).toBe(216);
    const over = { ...drum, material: { ...drum.material!, volumeL: 220 } };
    expect(issuesOf(over, plan).errors.volume).toMatch(/capacity/);
    const nearBrim = { ...drum, material: { ...drum.material!, volumeL: 212 } };
    expect(issuesOf(nearBrim, plan).warnings.some((w) => w.includes('97 % max fill'))).toBe(true);
    const custom = { ...drum, packaging: 'custom' as const, material: { ...drum.material!, volumeL: 30, containerCapacityL: 25 } };
    expect(issuesOf(custom, plan).errors.volume).toMatch(/capacity/);
    const broken = { ...drum, material: { ...drum.material!, densityKgPerL: 0, volumeL: 0 } };
    expect(Object.keys(issuesOf(broken, plan).errors)).toEqual(expect.arrayContaining(['density', 'volume']));
    expect(materialDef('lpg')?.pressurised).toBe(true);
  });
});

describe('dry bulk', () => {
  const tipperPlan = createTipperSeedPlan();
  const settings = tipperPlan.settings;
  const tronton = createVehicle('id-dump-tronton');
  const issuesOf = (spec: ItemSpec, p: Plan = tipperPlan) => checkDraft({ spec, quantity: 1, stopId: p.stops[0].id, priority: 'normal' }, p, deriveItem(spec, p));

  it('ships dry-bulk templates that are legal on an empty tronton dump truck', () => {
    const dry = BUILT_IN_TEMPLATES.filter((t) => t.spec.material?.state === 'solid');
    expect(dry.length).toBeGreaterThanOrEqual(8);
    for (const t of dry) {
      const m = t.spec.material!;
      expect(t.spec.weightKg, t.spec.name).toBeCloseTo(m.volumeL * m.densityKgPerL, 6);
      expect(fitVehicle(t.spec, tronton, settings).fits, t.spec.name).toBe(true);
    }
  });

  it('reports the legal maximum of a dump truck and flags overloads', () => {
    const wetSand = makeBulkSpec('sand-wet', 10_000);
    const fit = fitVehicle(wetSand, tronton, settings);
    expect(fit).toMatchObject({ fits: false, reason: 'overloaded' });
    expect(fit.detail).toBe('legal max 7.9 m³ (payload)');
    expect(fitVehicle(makeBulkSpec('coal', 16_000), tronton, settings)).toMatchObject({ fits: true, detail: expect.stringContaining('(capacity)') });
    expect(fitVehicle(makeBulkSpec('coal', 17_000), tronton, settings).reason).toMatch(/^body too small/);
    expect(fitVehicle(wetSand, createVehicle('tanker-semi-32k'), settings).reason).toBe('not a dump truck');
    expect(fitVehicle(makeBulkSpec('water', 5000), tronton, settings).reason).toBe('not a tanker');
    expect(deriveItem(wetSand, createSeedPlan()).presetFits.every((f) => f.name.startsWith('Dump truck'))).toBe(true);
  });

  it('splits an over-limit load into equal legal loads', () => {
    expect(splitLegalLoads(10_000, bestLegalFill(tronton, makeBulkSpec('sand-wet', 1).material!)!.litres)).toEqual({ count: 2, volumeL: 5000 });
    expect(splitLegalLoads(7000, 7895)).toEqual({ count: 1, volumeL: 7000 });
    const sand = tipperPlan.lines.find((l) => l.id === 'line-sand')!;
    expect(splitAdvice(tipperPlan, sand)).toMatchObject({ count: 2, volumeL: 5000, limitedBy: 'Payload' });
    expect(splitAdvice(tipperPlan, tipperPlan.lines.find((l) => l.id === 'line-gravel')!)).toBeNull();
    const unplaced = { ...tipperPlan, placements: {} };
    expect(splitAdvice(unplaced, sand)).toMatchObject({ count: 2, volumeL: 5000 });
  });

  it('warns with the split when a load overloads every dump truck', () => {
    expect(issuesOf(makeBulkSpec('sand-wet', 10_000)).warnings).toContain('Overloads every dump truck in this plan; split into 2 loads of 5.0 m³');
    expect(issuesOf(makeBulkSpec('sand-wet', 7_000))).toEqual({ errors: {}, blocking: [], warnings: [] });
    expect(issuesOf(makeBulkSpec('gravel', 9_000), createSeedPlan()).warnings).toContain('Needs a dump truck: add one that can carry it');
  });

  it('handles custom dry materials and big bags', () => {
    const custom = makeBulkSpec('sand-dry', 8000, { material: { materialId: 'custom', name: 'Fly ash', state: 'solid', densityKgPerL: 1.2, volumeL: 8000 }, weightKg: 9600 });
    expect(fitVehicle(custom, tronton, settings).fits).toBe(true);
    const bag = makeSpec({ name: 'Cement big bag', dims: { l: 0.9, w: 0.9, h: 1.1 }, weightKg: 1302, packaging: 'custom', material: { materialId: 'custom', name: 'Cement', state: 'solid', densityKgPerL: 1.3, volumeL: 1100, containerCapacityL: 1000 } });
    expect(issuesOf(bag, createSeedPlan()).errors.volume).toMatch(/capacity of 1\.0 m³/);
  });
});
