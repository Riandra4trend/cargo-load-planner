import { Scale } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { TEMP_COLORS, TEMP_LABELS, hazmatColor } from '../../domain/colors';
import { MATERIAL_CATEGORY_LABELS, MATERIAL_LIBRARY, materialDef, maxFillPct, type MaterialDef } from '../../domain/materials';
import { createVehicle } from '../../domain/presets';
import type { MaterialState, UnitSystem, Vehicle } from '../../domain/types';
import { formatMass, formatMaterialDensity, formatMaterialVolume, L_PER_CU_YD, L_PER_US_GAL, massParts } from '../../domain/units';
import { maxLegalFill } from '../../physics';
import { useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { ColorDot } from '../common/Chip';
import { Field, MaterialDensityInput, MaterialVolumeInput, SegmentedControl } from '../common/fields';
import { Modal } from '../common/Modal';
import { MaterialSelect } from './MaterialPicker';

/** Round calculator default in the display unit: 8,000 L / 2,000 gal of liquid, 10 m³ / 13 yd³ of dry bulk. */
const defaultVolumeL = (state: MaterialState, sys: UnitSystem): number => {
  if (state === 'liquid') return sys === 'metric' ? 8000 : 2000 * L_PER_US_GAL;
  return sys === 'metric' ? 10_000 : 13 * L_PER_CU_YD;
};

let tronton: Vehicle | null = null;
/** Legal load of a dry-bulk material on an empty tronton dump truck (the ODOL reference). */
function trontonLegal(m: MaterialDef): { litres: number; limitedBy: string } {
  tronton ??= createVehicle('id-dump-tronton', 'ref-tronton');
  return maxLegalFill(tronton, [], tronton.bulk!.compartments[0], { materialId: m.id, state: m.state, densityKgPerL: m.densityKgPerL });
}

function HazmatCell({ def }: { def: MaterialDef }) {
  if (!def.hazmat) return <span className="text-muted">-</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-grid h-4 min-w-6 place-items-center rounded px-1 font-mono text-[10px] font-bold text-white" style={{ background: hazmatColor(def.hazmat.hazClass) }}>
        {def.hazmat.hazClass}
      </span>
      <span className="font-mono text-ink-soft">{def.hazmat.unNumber}</span>
    </span>
  );
}

/** Reference of liquid and dry-bulk densities with a volume → weight calculator (dialogs.materials). */
export function MaterialWeightsDialog() {
  const sys = useUnitSystem();
  const closeDialog = useStore((s) => s.closeDialog);
  const close = useCallback(() => closeDialog('materials'), [closeDialog]);
  const [materialId, setMaterialId] = useState('water');
  const [customState, setCustomState] = useState<MaterialState>('liquid');
  const [customDensity, setCustomDensity] = useState(1);
  const [volumeL, setVolumeL] = useState(() => defaultVolumeL('liquid', sys));
  const [tab, setTab] = useState<MaterialState>('liquid');

  const def = materialDef(materialId);
  const state = def?.state ?? customState;
  const density = def?.densityKgPerL ?? customDensity;
  const [wValue, wUnit] = massParts(volumeL * density, sys);

  const pick = (id: string) => {
    const next = materialDef(id)?.state ?? customState;
    if (next !== state) setVolumeL(defaultVolumeL(next, sys));
    setMaterialId(id);
    setTab(next);
  };
  const setCustom = (s: MaterialState) => {
    if (s !== customState) setVolumeL(defaultVolumeL(s, sys));
    setCustomState(s);
    setTab(s);
  };

  const rows = useMemo(() => MATERIAL_LIBRARY.filter((m) => m.state === tab), [tab]);
  const solidTab = tab === 'solid';
  const refL = solidTab ? (sys === 'metric' ? 1000 : L_PER_CU_YD) : sys === 'metric' ? 1000 : 1000 * L_PER_US_GAL;
  const refLabel = solidTab ? (sys === 'metric' ? '1 m³' : '1 yd³') : sys === 'metric' ? '1,000 L' : '1,000 gal';
  const volumeLabel = formatMaterialVolume(volumeL, tab, sys);
  const headers = solidTab
    ? ['Material', 'Category', 'Bulk density', `Weight of ${refLabel}`, `Weight of ${volumeLabel}`, 'Legal on a tronton dump', 'Food', 'Note']
    : ['Liquid', 'Category', 'Density', `Weight of ${refLabel}`, `Weight of ${volumeLabel}`, 'Max fill', 'Hazmat', 'Food', 'Temp', 'Note'];
  /** Right-aligned numeric columns (density, reference weight, calculator weight, legal load / max fill). */
  const numeric = [2, 3, 4, 5];

  return (
    <Modal open title="Material weights" icon={<Scale />} onClose={close} width="max-w-6xl">
      <div className="flex flex-col gap-4">
        <section className="grid items-end gap-3 rounded-xl border border-line bg-canvas p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" aria-label="Weight calculator">
          <Field label="Material">
            <MaterialSelect value={materialId} onChange={pick} />
          </Field>
          <Field label={state === 'solid' ? 'Bulk density' : 'Density'} hint={def ? (state === 'solid' ? 'Typical loose density in the body' : 'Typical value at 15 °C') : 'Your product’s density'}>
            {def ? (
              <div className="flex h-9 items-center font-mono num text-sm text-ink">{formatMaterialDensity(density, state, sys)}</div>
            ) : (
              <div className="flex gap-1.5">
                <SegmentedControl<MaterialState>
                  label="Custom material state"
                  size="sm"
                  value={customState}
                  onChange={setCustom}
                  options={[
                    { value: 'liquid', label: 'Liquid' },
                    { value: 'solid', label: 'Dry bulk' },
                  ]}
                />
                <div className="min-w-0 flex-1">
                  <MaterialDensityInput kgPerL={customDensity} onChange={setCustomDensity} state={customState} sys={sys} min={0} aria-label="Custom density" />
                </div>
              </div>
            )}
          </Field>
          <Field label="Volume">
            <MaterialVolumeInput litres={volumeL} onChange={setVolumeL} state={state} sys={sys} aria-label="Volume" />
          </Field>
          <div className="pb-0.5 text-right" aria-live="polite">
            <div className="text-[11px] text-muted">Weight</div>
            <div className="font-mono num text-2xl font-semibold text-ink">
              {wValue} <span className="text-base font-medium text-muted">{wUnit}</span>
            </div>
          </div>
        </section>

        <SegmentedControl<MaterialState>
          label="Material type"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'liquid', label: `Liquids (${MATERIAL_LIBRARY.filter((m) => m.state === 'liquid').length})` },
            { value: 'solid', label: `Dry bulk (${MATERIAL_LIBRARY.filter((m) => m.state === 'solid').length})` },
          ]}
        />

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead className="bg-canvas text-left text-muted">
              <tr>
                {headers.map((h, i) => (
                  <th key={h} scope="col" className={`border-b border-line px-2 py-1.5 font-medium first:pl-3 ${numeric.includes(i) ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const active = m.id === materialId;
                const cell = 'border-b border-line px-2 py-1.5 whitespace-nowrap';
                const legal = solidTab ? trontonLegal(m) : null;
                return (
                  <tr key={m.id} onClick={() => pick(m.id)} aria-selected={active} className={`cursor-pointer hover:bg-canvas ${active ? 'bg-accent-soft' : ''}`}>
                    <td className={`${cell} pl-3`}>
                      <span className="flex items-center gap-2 font-medium text-ink">
                        <ColorDot color={m.color} className="ring-1 ring-black/10" />
                        {m.name}
                      </span>
                    </td>
                    <td className={`${cell} text-ink-soft`}>{MATERIAL_CATEGORY_LABELS[m.category]}</td>
                    <td className={`${cell} text-right font-mono num`}>{formatMaterialDensity(m.densityKgPerL, m.state, sys)}</td>
                    <td className={`${cell} text-right font-mono num`}>{formatMass(refL * m.densityKgPerL, sys)}</td>
                    <td className={`${cell} text-right font-mono num font-semibold text-ink`}>{formatMass(volumeL * m.densityKgPerL, sys)}</td>
                    {legal ? (
                      <td className={`${cell} text-right font-mono num`} title={`Limited by: ${legal.limitedBy}`}>
                        {formatMaterialVolume(legal.litres, 'solid', sys, 1)} · {formatMass(legal.litres * m.densityKgPerL, sys)}
                        <span className="ml-1 font-sans text-muted">({legal.limitedBy.toLowerCase()})</span>
                      </td>
                    ) : (
                      <>
                        <td className={`${cell} text-right font-mono num`}>{maxFillPct(m.id, m.state)} %</td>
                        <td className={cell}>
                          <HazmatCell def={m} />
                        </td>
                      </>
                    )}
                    <td className={cell}>{m.isFood ? <span className="font-medium text-ok">Yes</span> : <span className="text-muted">No</span>}</td>
                    {!solidTab && (
                      <td className={cell}>
                        <span className="inline-flex items-center gap-1" style={{ color: m.temp === 'ambient' ? undefined : TEMP_COLORS[m.temp] }}>
                          {m.temp !== 'ambient' && <ColorDot color={TEMP_COLORS[m.temp]} size={7} />}
                          {TEMP_LABELS[m.temp]}
                        </span>
                      </td>
                    )}
                    <td className={`${cell} max-w-72 truncate text-muted`} title={m.note}>
                      {m.note ?? (m.pressurised ? 'Pressure tank only' : '-')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted">
          {solidTab
            ? 'Loose bulk densities vary with moisture and grading; wet sand is about 20 % heavier than dry. “Legal on a tronton dump” is the largest load an empty tronton dump truck (6×4, 15 t payload, 16 m³ body) may carry under its payload, gross and axle limits: a body that looks half full of wet sand can already be overloaded.'
            : 'Typical densities at 15 °C; real products vary, so check the delivery note. Max fill is the share of a tank or container’s brim capacity that may be filled, leaving room for thermal expansion.'}{' '}
          Weight = volume × density.
        </p>
      </div>
    </Modal>
  );
}
