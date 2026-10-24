import { RotateCcw, Settings } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { TEMP_LABELS } from '../../domain/colors';
import { defaultSettings, HAZMAT_CLASS_NAMES, HAZMAT_CLASSES, hazmatRule } from '../../domain/settings';
import type { HazmatRule, PlanMeta, PlanSettings, TempClass, UnitSystem } from '../../domain/types';
import { bigLengthUnit, kgToLb, KM_PER_MI, L_PER_US_GAL, lbToKg, weightUnit } from '../../domain/units';
import { useStore } from '../../state/store';
import { Button } from '../common/Button';
import { Field, LengthInput, NumberInput, SegmentedControl, TextInput, WeightInput, inputClass } from '../common/fields';
import { Modal } from '../common/Modal';

/** Common currencies for fuel cost; any other ISO 4217 code already in the plan is kept. */
const CURRENCIES = ['USD', 'EUR', 'GBP', 'IDR', 'AUD', 'CAD', 'CHF', 'JPY', 'CNY', 'SGD', 'MYR', 'THB', 'INR', 'BRL', 'MXN', 'ZAR'];
const NEXT_RULE: Record<HazmatRule, HazmatRule> = { ok: 'separate', separate: 'never', never: 'ok' };
const RULE_CELL: Record<HazmatRule, [string, string]> = {
  ok: ['bg-ok-soft/60 text-ok/70', '·'],
  separate: ['bg-warn-soft text-warn', 'S'],
  never: ['bg-bad-soft text-bad', '✕'],
};
const RULE_LABEL: Record<HazmatRule, string> = { ok: 'may load together', separate: 'keep separated', never: 'never together' };
const TEMPS: TempClass[] = ['ambient', 'chilled', 'frozen'];

const toDisplayTemp = (c: number, sys: UnitSystem) => (sys === 'metric' ? c : (c * 9) / 5 + 32);
const fromDisplayTemp = (t: number, sys: UnitSystem) => (sys === 'metric' ? t : ((t - 32) * 5) / 9);

function Group({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <fieldset className="rounded-xl border border-line p-3.5">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">{title}</legend>
      {hint && <p className="mb-2 text-[11px] text-muted">{hint}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{children}</div>
    </fieldset>
  );
}

function HazmatMatrix({ settings, onChange }: { settings: PlanSettings; onChange: (m: PlanSettings['hazmatMatrix']) => void }) {
  const set = (a: string, b: string, rule: HazmatRule) => {
    const m: PlanSettings['hazmatMatrix'] = Object.fromEntries(HAZMAT_CLASSES.map((c) => [c, { ...(settings.hazmatMatrix[c] ?? {}) }]));
    if (rule === 'ok') {
      delete m[a][b];
      delete m[b][a];
    } else {
      m[a][b] = rule;
      m[b][a] = rule;
    }
    onChange(m);
  };
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-[10.5px]" aria-label="Hazmat compatibility matrix">
        <thead>
          <tr>
            <th />
            {HAZMAT_CLASSES.map((c) => (
              <th key={c} scope="col" className="num w-7 font-semibold text-muted" title={HAZMAT_CLASS_NAMES[c]}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HAZMAT_CLASSES.map((a) => (
            <tr key={a}>
              <th scope="row" className="num whitespace-nowrap pr-1.5 text-right font-semibold text-muted" title={HAZMAT_CLASS_NAMES[a]}>
                {a} <span className="hidden font-normal md:inline">{HAZMAT_CLASS_NAMES[a]}</span>
              </th>
              {HAZMAT_CLASSES.map((b) => {
                const rule = hazmatRule(settings, a, b);
                const [cls, glyph] = RULE_CELL[rule];
                return (
                  <td key={b} className="p-0">
                    <button
                      type="button"
                      onClick={() => set(a, b, NEXT_RULE[rule])}
                      aria-label={`Class ${a} with class ${b}: ${RULE_LABEL[rule]}. Click to change.`}
                      title={`${a} ${HAZMAT_CLASS_NAMES[a]} + ${b} ${HAZMAT_CLASS_NAMES[b]}: ${RULE_LABEL[rule]}`}
                      className={`h-6 w-7 rounded font-bold transition-colors hover:ring-1 hover:ring-ink/30 focus-visible:outline-2 focus-visible:outline-accent ${cls}`}
                    >
                      {glyph}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
        {(['ok', 'separate', 'never'] as HazmatRule[]).map((r) => (
          <span key={r} className="flex items-center gap-1">
            <span className={`inline-flex h-4 w-5 items-center justify-center rounded font-bold ${RULE_CELL[r][0]}`}>{RULE_CELL[r][1]}</span> {RULE_LABEL[r]}
          </span>
        ))}
        <span>Click a cell to cycle; the matrix stays symmetric. Defaults are illustrative, based on ADR 7.5.2 / 49 CFR 177.848.</span>
      </p>
    </div>
  );
}

/** Plan details and every plan setting with unit-aware inputs; saved as one undoable step. */
export function SettingsDialog() {
  const open = useStore((s) => !!s.ui.dialogs.settings);
  return open ? <SettingsForm /> : null;
}

function SettingsForm() {
  const plan = useStore((s) => s.plan);
  const commit = useStore((s) => s.commit);
  const closeDialog = useStore((s) => s.closeDialog);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(plan.name);
  const [meta, setMeta] = useState<PlanMeta>(plan.meta);
  const [settings, setSettings] = useState<PlanSettings>(plan.settings);
  const sys = settings.units;
  const small = sys === 'metric' ? 'cm' : 'in';
  const big = bigLengthUnit(sys);
  const patch = (p: Partial<PlanSettings>) => setSettings((s) => ({ ...s, ...p }));
  const patchMeta = (p: Partial<PlanMeta>) => setMeta((m) => ({ ...m, ...p }));
  const close = () => closeDialog('settings');
  const tempUnit = sys === 'metric' ? '°C' : '°F';

  const save = () => {
    commit('Edit settings', (d) => {
      d.name = name.trim() || d.name;
      d.meta = structuredClone(meta);
      d.settings = structuredClone(settings);
    });
    toast('Settings saved', 'success');
    close();
  };

  return (
    <Modal
      open
      onClose={close}
      title="Plan details and settings"
      icon={<Settings />}
      width="max-w-4xl"
      footer={
        <>
          <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} className="mr-auto" onClick={() => setSettings({ ...defaultSettings(), units: settings.units })}>
            Reset settings to defaults
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Group title="Plan details">
          <Field label="Plan name" className="col-span-2">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Driver">
            <TextInput value={meta.driver} onChange={(e) => patchMeta({ driver: e.target.value })} />
          </Field>
          <Field label="Departure date">
            <TextInput type="date" value={meta.date} onChange={(e) => patchMeta({ date: e.target.value })} />
          </Field>
          <Field label="Departure time">
            <TextInput type="time" value={meta.time} onChange={(e) => patchMeta({ time: e.target.value })} />
          </Field>
          <Field label="Dock">
            <TextInput value={meta.dock} onChange={(e) => patchMeta({ dock: e.target.value })} />
          </Field>
          <Field label="Route">
            <TextInput value={meta.route} onChange={(e) => patchMeta({ route: e.target.value })} />
          </Field>
          <Field label="Return to depot" hint="Empty drive after the last stop. Leg distances are set per stop in the sidebar.">
            <NumberInput
              value={sys === 'metric' ? meta.returnKm : meta.returnKm / KM_PER_MI}
              onChange={(n) => patchMeta({ returnKm: sys === 'metric' ? n : n * KM_PER_MI })}
              min={0}
              digits={1}
              suffix={sys === 'metric' ? 'km' : 'mi'}
            />
          </Field>
          <Field label="Notes" className="col-span-2 md:col-span-3">
            <textarea value={meta.notes} onChange={(e) => patchMeta({ notes: e.target.value })} rows={2} className={`${inputClass} h-auto py-2`} />
          </Field>
        </Group>

        <Group title="Units">
          <Field label="Unit system" hint="Applies to every input, table, chart and report.">
            <SegmentedControl<UnitSystem>
              label="Unit system"
              value={sys}
              onChange={(units) => patch({ units })}
              options={[
                { value: 'metric', label: 'Metric (m, kg)' },
                { value: 'imperial', label: 'Imperial (ft, lb)' },
              ]}
            />
          </Field>
        </Group>

        <Group title="Packing rules">
          <Field label="Minimum base support" hint="Share of a stacked unit's base that must rest on units below.">
            <NumberInput value={settings.supportRatio * 100} onChange={(n) => patch({ supportRatio: n / 100 })} min={10} max={100} digits={0} suffix="%" />
          </Field>
          <Field label="Ceiling clearance" hint="Free space kept below the roof.">
            <LengthInput metres={settings.ceilingClearance} onChange={(m) => patch({ ceilingClearance: m })} unit={small} />
          </Field>
          <Field label="Overlap tolerance">
            <LengthInput metres={settings.overlapTolerance} onChange={(m) => patch({ overlapTolerance: m })} unit={small} />
          </Field>
          <Field label="Drag snapping grid">
            <LengthInput metres={settings.snapGrid} onChange={(m) => patch({ snapGrid: m })} unit={small} />
          </Field>
          <Field label="Forklift capacity" hint="Heavier units get a warning.">
            <WeightInput kg={settings.forkliftCapacityKg} onChange={(kg) => patch({ forkliftCapacityKg: kg })} unit={weightUnit(sys)} />
          </Field>
          <Field label="Near-limit threshold" hint="Axle status turns NEAR LIMIT from here.">
            <NumberInput value={settings.nearLimit * 100} onChange={(n) => patch({ nearLimit: n / 100 })} min={50} max={100} digits={0} suffix="%" />
          </Field>
        </Group>

        <Group title="Fuel">
          <Field label={sys === 'metric' ? 'Diesel price per litre' : 'Diesel price per gallon'}>
            <div className="flex gap-1">
              <div className="min-w-0 flex-1">
                <NumberInput
                  value={sys === 'metric' ? settings.fuelPricePerL : settings.fuelPricePerL * L_PER_US_GAL}
                  onChange={(n) => patch({ fuelPricePerL: sys === 'metric' ? n : n / L_PER_US_GAL })}
                  min={0}
                  digits={3}
                  aria-label="Diesel price"
                />
              </div>
              <div className="w-[5.5rem] shrink-0">
                <select aria-label="Currency" value={settings.currency} onChange={(e) => patch({ currency: e.target.value })} className={inputClass}>
                  {[...new Set([settings.currency, ...CURRENCIES])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Field>
          <Field label="CO₂ per unit of diesel" hint="Tank-to-wheel; 2.68 kg/L for fossil diesel.">
            <NumberInput
              value={sys === 'metric' ? settings.co2KgPerL : kgToLb(settings.co2KgPerL) * L_PER_US_GAL}
              onChange={(n) => patch({ co2KgPerL: sys === 'metric' ? n : lbToKg(n) / L_PER_US_GAL })}
              min={0}
              digits={2}
              suffix={sys === 'metric' ? 'kg/L' : 'lb/gal'}
            />
          </Field>
          <Field label="Average driving speed" hint="Sets driving time, which the reefer runs for.">
            <NumberInput
              value={sys === 'metric' ? settings.avgSpeedKmh : settings.avgSpeedKmh / KM_PER_MI}
              onChange={(n) => patch({ avgSpeedKmh: sys === 'metric' ? n : n * KM_PER_MI })}
              min={1}
              digits={0}
              suffix={sys === 'metric' ? 'km/h' : 'mph'}
            />
          </Field>
          <Field label="Time at each stop" hint="The reefer keeps running while cold cargo is aboard.">
            <NumberInput value={settings.stopMinutes} onChange={(n) => patch({ stopMinutes: n })} min={0} digits={0} suffix="min" />
          </Field>
          <Field label="Engine idling at each stop">
            <NumberInput value={settings.idleMinutesPerStop} onChange={(n) => patch({ idleMinutesPerStop: n })} min={0} digits={0} suffix="min" />
          </Field>
        </Group>

        <Group title="Temperature ranges">
          {TEMPS.map((t) => (
            <Field key={t} label={TEMP_LABELS[t]}>
              <div className="flex items-center gap-1.5">
                <NumberInput
                  aria-label={`${TEMP_LABELS[t]} minimum`}
                  value={toDisplayTemp(settings.tempRanges[t].min, sys)}
                  onChange={(n) => patch({ tempRanges: { ...settings.tempRanges, [t]: { ...settings.tempRanges[t], min: fromDisplayTemp(n, sys) } } })}
                  digits={1}
                  suffix={tempUnit}
                />
                <span className="text-muted">to</span>
                <NumberInput
                  aria-label={`${TEMP_LABELS[t]} maximum`}
                  value={toDisplayTemp(settings.tempRanges[t].max, sys)}
                  onChange={(n) => patch({ tempRanges: { ...settings.tempRanges, [t]: { ...settings.tempRanges[t], max: fromDisplayTemp(n, sys) } } })}
                  digits={1}
                  suffix={tempUnit}
                />
              </div>
            </Field>
          ))}
        </Group>

        <fieldset className="rounded-xl border border-line p-3.5">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Hazardous goods</legend>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Separation distance" hint='For pairs marked "keep separated".'>
              <LengthInput metres={settings.hazmatSeparationM} onChange={(m) => patch({ hazmatSeparationM: m })} unit={big} />
            </Field>
            <Field label="Distance from food" hint="Classes 6.1 / 6.2 vs foodstuffs.">
              <LengthInput metres={settings.foodSeparationM} onChange={(m) => patch({ foodSeparationM: m })} unit={big} />
            </Field>
          </div>
          <HazmatMatrix settings={settings} onChange={(hazmatMatrix) => patch({ hazmatMatrix })} />
        </fieldset>

        <Group title="Optimiser">
          <Field label="Time budget">
            <NumberInput value={settings.optimiserTimeMs / 1000} onChange={(n) => patch({ optimiserTimeMs: Math.round(n * 1000) })} min={0.5} max={60} digits={1} suffix="s" />
          </Field>
          <Field label="Random seed" hint="Same seed + same plan = same result.">
            <NumberInput value={settings.seed} onChange={(n) => patch({ seed: Math.round(n) })} min={0} digits={0} />
          </Field>
        </Group>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
