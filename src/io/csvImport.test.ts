import { describe, expect, it } from 'vitest';
import { createEmptyPlan } from '../data/emptyPlan';
import { createSeedPlan, createTankerSeedPlan, makeSpec } from '../data/seed';
import { L_PER_US_GAL, lbToKg, M_PER_IN } from '../domain/units';
import { itemsToCsv } from './csv';
import {
  autoMapColumns,
  bindNewStops,
  findLiquid,
  normaliseHazClass,
  normaliseUnNumber,
  parseBoolCell,
  parseCsvText,
  parseNumberCell,
  parseTempCell,
  rowsToLines,
  type ImportUnits,
} from './csvImport';
import { parsePlanJson } from './planFile';
import { buildShareUrl, readShareHash } from './share';

const SI: ImportUnits = { lengthUnit: 'm', weightUnit: 'kg', volumeUnit: 'L', densityUnit: 'kg/L' };

describe('parseCsvText', () => {
  it('detects comma, semicolon and tab delimiters', () => {
    expect(parseCsvText('a,b\n1,2').delimiter).toBe(',');
    expect(parseCsvText('a;b\n1,5;2').delimiter).toBe(';');
    const tsv = parseCsvText('Item\tQty\r\nPallet, mixed\t3\r\n\r\n');
    expect(tsv.delimiter).toBe('\t');
    expect(tsv.headers).toEqual(['Item', 'Qty']);
    expect(tsv.rows).toEqual([['Pallet, mixed', '3']]);
  });

  it('pads short rows, strips a BOM and rejects empty input', () => {
    expect(parseCsvText('\uFEFFname,qty,sku\nBox,2').rows).toEqual([['Box', '2', '']]);
    expect(() => parseCsvText('  \n ')).toThrow();
    expect(() => parseCsvText('name,qty')).toThrow(/header row/);
  });
});

describe('autoMapColumns', () => {
  it('maps aliases case- and space-insensitively and detects unit suffixes', () => {
    const { mapping, lengthUnit, weightUnit } = autoMapColumns(['Item Description', 'Article', 'Length (in)', 'Width (in)', 'Height (in)', 'Gross Weight (lbs)', 'QTY', 'Destination', 'Temp', 'UN #', 'Hazmat Class', 'Packing group', 'Keep upright', 'Max load on top']);
    expect(mapping).toMatchObject({ name: 0, sku: 1, length: 2, width: 3, height: 4, weight: 5, quantity: 6, stop: 7, temp: 8, unNumber: 9, hazClass: 10, packingGroup: 11, keepUpright: 12, maxLoadOnTop: 13 });
    expect(lengthUnit).toBe('in');
    expect(weightUnit).toBe('lb');
  });

  it('reads snake_case export headers with metric suffixes', () => {
    const r = autoMapColumns(['name', 'length_cm', 'width_cm', 'height_cm', 'weight_kg', 'pallet_height_m', 'cog_offset_x_m', 'stop_sequence']);
    expect(r.mapping).toMatchObject({ name: 0, length: 1, width: 2, height: 3, weight: 4, palletHeight: 5, cogX: 6, stop: 7 });
    expect(r.lengthUnit).toBe('cm');
    expect(r.weightUnit).toBe('kg');
  });

  it('does not map one column twice', () => {
    const r = autoMapColumns(['L', 'W', 'H', 'Weight', 'Weight']);
    expect(r.mapping).toEqual({ length: 0, width: 1, height: 2, weight: 3 });
    expect(r.lengthUnit).toBeUndefined();
  });
});

describe('cell parsers', () => {
  it('parses numbers in common locales', () => {
    expect(parseNumberCell('1200')).toBe(1200);
    expect(parseNumberCell('1,200.5')).toBe(1200.5);
    expect(parseNumberCell('1.200,5')).toBe(1200.5);
    expect(parseNumberCell('1,5')).toBe(1.5);
    expect(parseNumberCell('1 450')).toBe(1450);
    expect(parseNumberCell('abc')).toBeNaN();
    expect(parseNumberCell('')).toBeNaN();
  });

  it('parses booleans, temperatures and hazmat codes', () => {
    expect(['yes', 'TRUE', '1', 'x', 'Y'].map(parseBoolCell)).toEqual([true, true, true, true, true]);
    expect(['no', 'false', '0', 'N'].map(parseBoolCell)).toEqual([false, false, false, false]);
    expect(parseBoolCell('')).toBeUndefined();
    expect(parseBoolCell('maybe')).toBeNull();
    expect(['Frozen', 'deep-frozen', '-18', '-20 °C'].map(parseTempCell)).toEqual(['frozen', 'frozen', 'frozen', 'frozen']);
    expect(['chilled', 'Refrigerated', '+2', '4°C'].map(parseTempCell)).toEqual(['chilled', 'chilled', 'chilled', 'chilled']);
    expect(['', 'dry', 'ambient', '20'].map(parseTempCell)).toEqual(['ambient', 'ambient', 'ambient', 'ambient']);
    expect(parseTempCell('lukewarm')).toBeNull();
    expect(normaliseUnNumber('un 3480')).toBe('UN3480');
    expect(normaliseUnNumber('1263')).toBe('UN1263');
    expect(normaliseUnNumber('NA1993')).toBe('NA1993');
    expect(normaliseUnNumber('UN34')).toBeNull();
    expect(normaliseHazClass('Class 2.1')).toBe('2.1');
    expect(normaliseHazClass('5.1 (oxidiser)')).toBe('5.1');
    expect(normaliseHazClass('10')).toBeNull();
  });
});

describe('rowsToLines', () => {
  const TSV = [
    'Item\tSKU\tQty\tLength (in)\tWidth (in)\tHeight (in)\tWeight (lb)\tStop\tTemp\tUN\tClass\tStackable',
    'Frozen peas\tFZ-1\t2\t48\t40\t60\t1,500\tFreshFields Market, Oak Street\tfrozen\t\t\tyes',
    'Lithium cells\tBAT-9\t1\t48\t40\t40\t900\tNew Depot\t\tUN3480\t9\tno',
    'Broken row\tBR-1\t1\tabc\t40\t40\t900\t\t\t\t\t',
    'Bad UN\tBR-2\t1\t48\t40\t40\t900\tNew Depot\t\tUN34\t9\t',
    'More cells\tBAT-10\t3\t1200 mm\t40\t40\t900\tnew depot\t\t3480\t9\t',
  ].join('\n');

  it('imports pasted TSV with auto-mapping, inch/lb conversion, a bad-row report and new stops', () => {
    const plan = createSeedPlan();
    const { headers, rows } = parseCsvText(TSV);
    const { mapping, lengthUnit, weightUnit } = autoMapColumns(headers);
    expect(lengthUnit).toBe('in');
    expect(weightUnit).toBe('lb');
    const result = rowsToLines(rows, mapping, { ...SI, lengthUnit: lengthUnit!, weightUnit: weightUnit! }, plan);

    expect(result.lines).toHaveLength(3);
    expect(result.skipped).toBe(2);
    expect(result.rowOfLine).toEqual([2, 3, 6]);

    const [peas, cells, more] = result.lines;
    expect(peas.spec.dims.l).toBeCloseTo(48 * M_PER_IN, 9);
    expect(peas.spec.dims.h).toBeCloseTo(60 * M_PER_IN, 9);
    expect(peas.spec.weightKg).toBeCloseTo(lbToKg(1500), 9);
    expect(peas.spec.temp).toBe('frozen');
    expect(peas.spec.stackable).toBe(true);
    expect(peas.spec.maxLoadOnTopKg).toBeCloseTo(lbToKg(1500), 9);
    expect(peas.quantity).toBe(2);
    expect(peas.stopId).toBe(plan.stops.find((s) => s.name === 'FreshFields Market, Oak Street')!.id);

    expect(cells.spec.hazmat).toEqual({ unNumber: 'UN3480', hazClass: '9' });
    expect(more.spec.dims.l).toBeCloseTo(1.2, 9);
    expect(more.spec.hazmat?.unNumber).toBe('UN3480');

    // one new stop, shared case-insensitively by both rows
    expect(result.newStops).toEqual([{ key: cells.stopId, name: 'New Depot', customerName: 'New Depot' }]);
    expect(more.stopId).toBe(cells.stopId);

    const errors = result.report.filter((r) => r.level === 'error');
    expect(errors.map((e) => e.row)).toEqual([4, 5]);
    expect(errors[0].message).toMatch(/Length "abc"/);
    expect(errors[1].message).toMatch(/UN number "UN34"/);
    expect(result.report.some((r) => r.level === 'warning' && r.row === 3 && /new stop/.test(r.message))).toBe(true);

    const bound = bindNewStops(result.lines, result.newStops, ['stop-new']);
    expect(bound.map((l) => l.stopId)).toEqual([peas.stopId, 'stop-new', 'stop-new']);
  });

  it('flags missing required columns and invalid quantities', () => {
    const plan = createEmptyPlan();
    const { headers, rows } = parseCsvText('name,qty,length,width\nCrate,0,1,1\nCrate,2.5,1,1');
    const { mapping } = autoMapColumns(headers);
    const result = rowsToLines(rows, mapping, SI, plan);
    expect(result.lines).toHaveLength(0);
    expect(result.report.filter((r) => r.row === 0 && r.level === 'error')).toHaveLength(2);
    expect(result.report.some((r) => r.row === 2 && /Quantity "0"/.test(r.message))).toBe(true);
    expect(result.report.some((r) => r.row === 3 && /Quantity "2.5"/.test(r.message))).toBe(true);
  });

  it('round-trips the seed plan through itemsToCsv', () => {
    const plan = createSeedPlan();
    const { headers, rows } = parseCsvText(itemsToCsv(plan));
    const { mapping, lengthUnit, weightUnit } = autoMapColumns(headers);
    expect(lengthUnit).toBe('m');
    expect(weightUnit).toBe('kg');
    const result = rowsToLines(rows, mapping, SI, plan);
    expect(result.report.filter((r) => r.level === 'error')).toEqual([]);
    expect(result.newStops).toEqual([]);
    expect(result.lines).toHaveLength(plan.lines.length);
    result.lines.forEach((line, i) => {
      const original = plan.lines[i];
      expect(line.spec).toEqual(original.spec);
      expect(line.quantity).toBe(original.quantity);
      expect(line.stopId).toBe(original.stopId);
      expect(line.priority).toBe(original.priority);
      expect(line.contents).toBe(original.contents);
    });
  });

  it('finds library liquids by id, name or alias', () => {
    expect(['diesel', 'Diesel (solar)', 'SOLAR', 'bensin', 'Crude oil', 'cpo', 'brine', 'LPG'].map((t) => findLiquid(t)?.id)).toEqual([
      'diesel',
      'diesel',
      'diesel',
      'gasoline',
      'crude-oil',
      'palm-oil',
      'seawater',
      'lpg',
    ]);
    expect(findLiquid('unobtainium')).toBeUndefined();
  });

  it('imports bulk and packaged liquids: gallons, library data, container defaults and computed weights', () => {
    const plan = createTankerSeedPlan();
    const tsv = [
      'Item\tLiquid\tContainer\tVolume (gal)\tDensity (lb/gal)\tQty\tStop',
      'Diesel delivery\tsolar\tbulk\t2,000\t\t1\tNew Depot',
      'Rain water\twater\tIBC\t1000 L\t\t4\t1',
      '\tSulfuric acid 98 %\tdrum\t\t\t2\t1',
      'Mystery\tunobtainium\tbulk\t500\t\t1\t1',
      'Heavy diesel\tdiesel\ttanker\t100\t7.1\t1\t1',
    ].join('\n');
    const { headers, rows } = parseCsvText(tsv);
    const auto = autoMapColumns(headers);
    expect(auto.volumeUnit).toBe('gal');
    expect(auto.densityUnit).toBe('lb/gal');
    const result = rowsToLines(rows, auto.mapping, { ...SI, volumeUnit: auto.volumeUnit!, densityUnit: auto.densityUnit! }, plan);

    expect(result.report.filter((r) => r.row === 0 && r.level === 'error')).toEqual([]);
    expect(result.rowOfLine).toEqual([2, 3, 4, 6]);
    const [diesel, water, acid, heavy] = result.lines.map((l) => l.spec);

    expect(diesel.packaging).toBe('bulk-liquid');
    expect(diesel.liquid).toEqual({ liquidId: 'diesel', name: 'Diesel (solar)', densityKgPerL: 0.84, volumeL: 2000 * L_PER_US_GAL });
    expect(diesel.weightKg).toBeCloseTo(2000 * L_PER_US_GAL * 0.84, 6);
    expect(diesel.hazmat).toEqual({ unNumber: 'UN1202', hazClass: '3', packingGroup: 'III' });
    expect(diesel.dims).toEqual({ l: 1, w: 1, h: 1 });
    expect(diesel.rotation).toBe('none');
    expect(diesel.category).toBe('Bulk liquid');
    expect(result.lines[0].stopId).toBe(result.newStops[0].key);

    expect(water.packaging).toBe('ibc');
    expect(water.liquid?.volumeL).toBe(1000);
    expect(water.weightKg).toBe(1000 + 60);
    expect(water.dims).toEqual({ l: 1.2, w: 1.0, h: 1.15 });
    expect(water.hazmat).toBeUndefined();
    expect(result.lines[1].quantity).toBe(4);

    expect(acid.name).toBe('Sulfuric acid 98 %');
    expect(acid.shape).toBe('cylinder-upright');
    expect(acid.liquid?.volumeL).toBe(200);
    expect(acid.weightKg).toBeCloseTo(200 * 1.84 + 18, 6);
    expect(acid.hazmat?.hazClass).toBe('8');

    expect(heavy.liquid?.densityKgPerL).toBeCloseTo(lbToKg(7.1) / L_PER_US_GAL, 9);
    expect(result.report.some((r) => r.row === 5 && r.level === 'error' && /not in the liquid library/.test(r.message))).toBe(true);
  });

  it('round-trips bulk fills, packaged and custom liquids through itemsToCsv', () => {
    const plan = createTankerSeedPlan();
    const stopId = plan.stops[0].id;
    plan.lines.push(
      {
        id: 'line-drum',
        quantity: 3,
        stopId,
        priority: 'normal',
        spec: makeSpec({
          name: 'Diesel in drums',
          packaging: 'drum',
          shape: 'cylinder-upright',
          dims: { l: 0.585, w: 0.585, h: 0.88 },
          weightKg: 200 * 0.84 + 18,
          liquid: { liquidId: 'diesel', name: 'Diesel (solar)', densityKgPerL: 0.84, volumeL: 200 },
          hazmat: { unNumber: 'UN1202', hazClass: '3', packingGroup: 'III' },
        }),
      },
      {
        id: 'line-coolant',
        quantity: 1,
        stopId,
        priority: 'urgent',
        spec: makeSpec({
          name: 'Coolant concentrate',
          dims: { l: 0.4, w: 0.3, h: 0.5 },
          weightKg: 58.5,
          liquid: { liquidId: 'custom', name: 'Coolant concentrate', densityKgPerL: 1.11, volumeL: 50, containerCapacityL: 60 },
        }),
      },
    );
    const { headers, rows } = parseCsvText(itemsToCsv(plan));
    const result = rowsToLines(rows, autoMapColumns(headers).mapping, SI, plan);
    expect(result.report.filter((r) => r.level === 'error')).toEqual([]);
    expect(result.lines).toHaveLength(plan.lines.length);
    result.lines.forEach((line, i) => {
      expect(line.spec).toEqual(plan.lines[i].spec);
      expect(line.quantity).toBe(plan.lines[i].quantity);
      expect(line.stopId).toBe(plan.lines[i].stopId);
      expect(line.priority).toBe(plan.lines[i].priority);
    });
  });
});

describe('plan JSON and share link', () => {
  it('round-trips the full plan through JSON exactly', () => {
    const plan = createSeedPlan();
    expect(parsePlanJson(JSON.stringify(plan))).toEqual(plan);
    expect(parsePlanJson(JSON.stringify(plan, null, 2))).toEqual(plan);
  });

  it('rejects broken plan files with readable messages', () => {
    expect(() => parsePlanJson('{')).toThrow(/not valid JSON/);
    expect(() => parsePlanJson('{"version":2}')).toThrow(/version 1/);
    const plan = createSeedPlan();
    const broken = { ...plan, lines: [{ ...plan.lines[0], stopId: 'nope' }] };
    expect(() => parsePlanJson(JSON.stringify(broken))).toThrow(/unknown stop/);
  });

  it('round-trips the plan through a share link', () => {
    const plan = createSeedPlan();
    const url = buildShareUrl(plan, 'https://example.test/app/#old');
    expect(url.startsWith('https://example.test/app/#plan=')).toBe(true);
    expect(readShareHash(url.slice(url.indexOf('#')))).toEqual(plan);
    expect(readShareHash('#plan=garbage')).toBeNull();
    expect(readShareHash('#other')).toBeNull();
  });

  it('round-trips a tanker plan through a share link', () => {
    const plan = createTankerSeedPlan();
    expect(readShareHash(buildShareUrl(plan, 'https://example.test/').slice('https://example.test/'.length))).toEqual(plan);
  });
});
