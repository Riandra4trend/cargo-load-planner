import { describe, expect, it } from 'vitest';
import { makeBulkSpec, makeSpec } from '../data/seed';
import { withMaterialVolume } from './materials';

describe('withMaterialVolume', () => {
  it('keeps a container’s tare: a 200 L diesel drum (18 kg) refilled to 150 L weighs 150 × 0.84 + 18', () => {
    const drum = makeSpec({
      name: 'Diesel drum',
      dims: { l: 0.585, w: 0.585, h: 0.88 },
      weightKg: 200 * 0.84 + 18,
      packaging: 'drum',
      material: { materialId: 'diesel', name: 'Diesel (solar)', state: 'liquid', densityKgPerL: 0.84, volumeL: 200 },
    });
    const refilled = withMaterialVolume(drum, 150);
    expect(refilled.weightKg).toBeCloseTo(150 * 0.84 + 18, 9);
    expect(refilled.material?.volumeL).toBe(150);
  });

  it('weighs a bulk fill as volume × density only', () => {
    const water = withMaterialVolume(makeBulkSpec('water', 7800), 4900);
    expect(water.weightKg).toBeCloseTo(4900, 9);
  });
});
