import { Droplets } from 'lucide-react';
import { useCallback, useState } from 'react';
import { TEMP_COLORS, TEMP_LABELS, hazmatColor } from '../../domain/colors';
import { CUSTOM_LIQUID_ID, LIQUIDS, liquidDef, maxFillPct } from '../../domain/liquids';
import { formatLiquidDensity, formatLitres, formatMass, L_PER_US_GAL, massParts } from '../../domain/units';
import { useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { ColorDot } from '../common/Chip';
import { Field, LiquidDensityInput, LitresInput } from '../common/fields';
import { Modal } from '../common/Modal';
import { LIQUID_CATEGORY_LABELS, LiquidSelect } from './LiquidPicker';

/** Reference of liquid densities with a volume → weight calculator (dialogs.liquids). */
export function LiquidWeightsDialog() {
  const sys = useUnitSystem();
  const closeDialog = useStore((s) => s.closeDialog);
  const close = useCallback(() => closeDialog('liquids'), [closeDialog]);
  const [liquidId, setLiquidId] = useState('water');
  const [customDensity, setCustomDensity] = useState(1);
  // A round default in the display unit: 8,000 L or 2,000 gal.
  const [volumeL, setVolumeL] = useState(() => (sys === 'metric' ? 8000 : 2000 * L_PER_US_GAL));

  const density = liquidId === CUSTOM_LIQUID_ID ? customDensity : (liquidDef(liquidId)?.densityKgPerL ?? 0);
  const [wValue, wUnit] = massParts(volumeL * density, sys);
  const refL = sys === 'metric' ? 1000 : 1000 * L_PER_US_GAL;
  const refLabel = sys === 'metric' ? '1,000 L' : '1,000 gal';
  const volumeLabel = formatLitres(volumeL, sys, 0);

  return (
    <Modal open title="Liquid weights" icon={<Droplets />} onClose={close} width="max-w-6xl">
      <div className="flex flex-col gap-4">
        <section className="grid items-end gap-3 rounded-xl border border-line bg-canvas p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" aria-label="Weight calculator">
          <Field label="Liquid">
            <LiquidSelect value={liquidId} onChange={setLiquidId} />
          </Field>
          <Field label="Density" hint={liquidId === CUSTOM_LIQUID_ID ? 'Your product’s density' : 'Typical value at 15 °C'}>
            {liquidId === CUSTOM_LIQUID_ID ? (
              <LiquidDensityInput kgPerL={customDensity} onChange={setCustomDensity} sys={sys} min={0} aria-label="Custom density" />
            ) : (
              <div className="flex h-9 items-center font-mono num text-sm text-ink">{formatLiquidDensity(density, sys)}</div>
            )}
          </Field>
          <Field label="Volume">
            <LitresInput litres={volumeL} onChange={setVolumeL} sys={sys} aria-label="Volume" />
          </Field>
          <div className="pb-0.5 text-right" aria-live="polite">
            <div className="text-[11px] text-muted">Weight</div>
            <div className="font-mono num text-2xl font-semibold text-ink">
              {wValue} <span className="text-base font-medium text-muted">{wUnit}</span>
            </div>
          </div>
        </section>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead className="bg-canvas text-left text-muted">
              <tr>
                {['Liquid', 'Category', 'Density', `Weight of ${refLabel}`, `Weight of ${volumeLabel}`, 'Max fill', 'Hazmat', 'Food', 'Temp', 'Note'].map((h, i) => (
                  <th key={h} scope="col" className={`border-b border-line px-2 py-1.5 font-medium first:pl-3 ${i >= 2 && i <= 5 ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LIQUIDS.map((l) => {
                const active = l.id === liquidId;
                const cell = 'border-b border-line px-2 py-1.5 whitespace-nowrap';
                return (
                  <tr key={l.id} onClick={() => setLiquidId(l.id)} aria-selected={active} className={`cursor-pointer hover:bg-canvas ${active ? 'bg-accent-soft' : ''}`}>
                    <td className={`${cell} pl-3`}>
                      <span className="flex items-center gap-2 font-medium text-ink">
                        <ColorDot color={l.color} className="ring-1 ring-black/10" />
                        {l.name}
                      </span>
                    </td>
                    <td className={`${cell} text-ink-soft`}>{LIQUID_CATEGORY_LABELS[l.category]}</td>
                    <td className={`${cell} text-right font-mono num`}>{formatLiquidDensity(l.densityKgPerL, sys)}</td>
                    <td className={`${cell} text-right font-mono num`}>{formatMass(refL * l.densityKgPerL, sys)}</td>
                    <td className={`${cell} text-right font-mono num font-semibold text-ink`}>{formatMass(volumeL * l.densityKgPerL, sys)}</td>
                    <td className={`${cell} text-right font-mono num`}>{maxFillPct(l.id)} %</td>
                    <td className={cell}>
                      {l.hazmat ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-grid h-4 min-w-6 place-items-center rounded px-1 font-mono text-[10px] font-bold text-white" style={{ background: hazmatColor(l.hazmat.hazClass) }}>
                            {l.hazmat.hazClass}
                          </span>
                          <span className="font-mono text-ink-soft">{l.hazmat.unNumber}</span>
                        </span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className={cell}>{l.isFood ? <span className="font-medium text-ok">Yes</span> : <span className="text-muted">No</span>}</td>
                    <td className={cell}>
                      <span className="inline-flex items-center gap-1" style={{ color: l.temp === 'ambient' ? undefined : TEMP_COLORS[l.temp] }}>
                        {l.temp !== 'ambient' && <ColorDot color={TEMP_COLORS[l.temp]} size={7} />}
                        {TEMP_LABELS[l.temp]}
                      </span>
                    </td>
                    <td className={`${cell} max-w-72 truncate text-muted`} title={l.note}>
                      {l.note ?? (l.pressurised ? 'Pressure tank only' : '-')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted">
          Typical densities at 15 °C; real products vary, so check the delivery note. Weight = volume × density. Max fill is the share of a tank or container’s brim capacity that may be filled, leaving room for thermal expansion.
        </p>
      </div>
    </Modal>
  );
}
