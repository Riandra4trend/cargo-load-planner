import { Plus, Siren, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useState } from 'react';
import { makeSpec } from '../../data/seed';
import { TEMP_LABELS } from '../../domain/colors';
import { isBulk, unitIdOf } from '../../domain/geometry';
import type { CargoLine, Dims, Id, ItemSpec, TempClass } from '../../domain/types';
import { formatDims, formatMaterialVolume, formatWeight, itemLengthUnit, weightUnit } from '../../domain/units';
import { useStore } from '../../state/store';
import { Button, IconButton } from '../common/Button';
import { Field, inputClass, LengthInput, NumberInput, Select, TextInput, Toggle, WeightInput } from '../common/fields';
import { Modal } from '../common/Modal';
import { fitVehicle } from './itemChecks';
import { placeOnVehicle, targetVehicleId } from './placement';
import { StopPicker } from './StopPicker';
import { TEMPLATE_GROUPS, templateGroup, useAllTemplates } from './TemplatePicker';

interface TemplateRow {
  key: number;
  kind: 'template';
  templateId: Id;
  quantity: number;
}

interface CustomRow {
  key: number;
  kind: 'custom';
  name: string;
  dims: Dims;
  weightKg: number;
  temp: TempClass;
  stackable: boolean;
  quantity: number;
}

type Row = TemplateRow | CustomRow;

let rowSeq = 0;
const templateRow = (): TemplateRow => ({ key: ++rowSeq, kind: 'template', templateId: '', quantity: 1 });
const customRow = (): CustomRow => ({ key: ++rowSeq, kind: 'custom', name: '', dims: { l: 1.2, w: 0.8, h: 1.2 }, weightKg: 0, temp: 'ambient', stackable: false, quantity: 1 });

export function UrgentOrderDialog() {
  const plan = useStore((s) => s.plan);
  const running = useStore((s) => s.ui.optimise.running || !!s.ui.optimise.diff);
  const closeDialog = useStore((s) => s.closeDialog);
  const addLines = useStore((s) => s.addLines);
  const setHighlightLines = useStore((s) => s.setHighlightLines);
  const startOptimise = useStore((s) => s.startOptimise);
  const toast = useStore((s) => s.toast);
  const templates = useAllTemplates();
  const sys = plan.settings.units;
  const lenUnit = itemLengthUnit(sys);
  const wUnit = weightUnit(sys);

  const [stopId, setStopId] = useState<Id>(() => [...plan.stops].sort((a, b) => a.sequence - b.sequence)[0]?.id ?? '');
  const [rows, setRows] = useState<Row[]>(() => [templateRow()]);
  const [tried, setTried] = useState(false);

  const close = useCallback(() => closeDialog('urgent'), [closeDialog]);
  const patchRow = (key: number, patch: Partial<TemplateRow> | Partial<CustomRow>) => setRows((rs) => rs.map((r) => (r.key === key ? ({ ...r, ...patch } as Row) : r)));

  const specOf = (r: Row): ItemSpec | null => {
    if (r.kind === 'template') {
      const t = templates.find((x) => x.id === r.templateId);
      return t ? structuredClone(t.spec) : null;
    }
    return makeSpec({
      name: r.name.trim(),
      dims: { ...r.dims },
      weightKg: r.weightKg,
      temp: r.temp,
      stackable: r.stackable,
      maxLoadOnTopKg: r.stackable ? r.weightKg : 0,
      maxStackLayers: r.stackable ? 2 : 1,
      category: 'Urgent order',
    });
  };

  const rowError = (r: Row): string | null => {
    if (!(Number.isInteger(r.quantity) && r.quantity >= 1)) return 'Quantity must be a whole number ≥ 1';
    if (r.kind === 'template') return r.templateId ? null : 'Choose a template';
    if (!r.name.trim()) return 'Name is required';
    if (!(r.dims.l > 0 && r.dims.w > 0 && r.dims.h > 0)) return 'Dimensions must be positive';
    if (!(r.weightKg > 0)) return 'Weight must be positive';
    return null;
  };

  const rowWarning = (r: Row): string | null => {
    const spec = specOf(r);
    if (!spec || rowError(r)) return null;
    const fits = plan.vehicles.map((v) => fitVehicle(spec, v, plan.settings));
    if (!fits.some((f) => f.fits)) return `Fits no vehicle in this plan (${fits[0]?.reason ?? 'no vehicle'})`;
    if (fits.every((f) => !f.fits || f.reason)) return fits.find((f) => f.reason)?.reason ?? null;
    return null;
  };

  const errors = rows.map(rowError);
  const stopValid = plan.stops.some((s) => s.id === stopId);
  const valid = rows.length > 0 && stopValid && errors.every((e) => !e);
  const totalUnits = rows.reduce((s, r) => s + (Number.isFinite(r.quantity) ? r.quantity : 0), 0);

  const submit = () => {
    setTried(true);
    if (!valid || running) return;
    const addedAt = Date.now();
    const lines: Omit<CargoLine, 'id'>[] = rows.map((r) => {
      const template = r.kind === 'template' ? templates.find((t) => t.id === r.templateId) : undefined;
      return { spec: specOf(r)!, quantity: r.quantity, contents: template?.contents, stopId, priority: 'urgent', addedAt };
    });
    const ids = addLines(lines);
    // Bulk fills go straight into a free tank compartment or dump body; the stable re-plan then keeps them there.
    let filled = 0;
    lines.forEach((l, i) => {
      if (!isBulk(l.spec)) return;
      const vehicleId = targetVehicleId(l.spec);
      if (vehicleId) filled += placeOnVehicle(Array.from({ length: l.quantity }, (_, k) => unitIdOf(ids[i], k)), vehicleId);
    });
    setHighlightLines(ids);
    closeDialog('urgent');
    toast(`Urgent order: ${totalUnits} unit${totalUnits === 1 ? '' : 's'} added${filled ? ` (${filled} bulk fill${filled === 1 ? '' : 's'} assigned)` : ''}, re-planning…`, 'info');
    startOptimise({ keepExisting: true });
  };

  const footer = (
    <>
      <div className="mr-auto text-xs text-muted">{running ? 'Finish the running optimisation first' : 'Existing placements are kept where possible'}</div>
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
      <Button variant="primary" onClick={submit} disabled={running || (tried && !valid)}>
        Add &amp; re-plan
      </Button>
    </>
  );

  return (
    <Modal open title="Urgent order" icon={<Siren />} onClose={close} width="max-w-3xl" footer={footer}>
      <div className="flex flex-col gap-4">
        <Field label="Deliver to stop" error={tried && !stopValid ? 'Choose a delivery stop' : undefined}>
          <StopPicker value={stopId} onChange={setStopId} invalid={tried && !stopValid} />
        </Field>

        <div className="flex flex-col gap-2">
          {rows.map((r, i) => {
            const spec = r.kind === 'template' ? specOf(r) : null;
            const warning = rowWarning(r);
            return (
              <div key={r.key} className="rounded-lg border border-line p-3">
                <div className="flex items-end gap-2">
                  {r.kind === 'template' ? (
                    <Field label={`Item ${i + 1} · template`} className="flex-1">
                      <select
                        value={r.templateId}
                        onChange={(e) => patchRow(r.key, { templateId: e.target.value })}
                        aria-label={`Template for item ${i + 1}`}
                        className={`${inputClass} pr-7`}
                      >
                        <option value="">Choose a template…</option>
                        {TEMPLATE_GROUPS.map((g) => {
                          const items = templates.filter((t) => templateGroup(t) === g);
                          return items.length ? (
                            <optgroup key={g} label={g}>
                              {items.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.spec.name}
                                </option>
                              ))}
                            </optgroup>
                          ) : null;
                        })}
                      </select>
                    </Field>
                  ) : (
                    <Field label={`Item ${i + 1} · custom`} className="flex-1">
                      <TextInput value={r.name} onChange={(e) => patchRow(r.key, { name: e.target.value })} placeholder="Item name" aria-label={`Name of item ${i + 1}`} />
                    </Field>
                  )}
                  <Field label="Qty" className="w-20">
                    <NumberInput value={r.quantity} onChange={(quantity) => patchRow(r.key, { quantity })} digits={0} min={1} aria-label={`Quantity of item ${i + 1}`} />
                  </Field>
                  <IconButton label={`Remove item ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={rows.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
                {spec && (
                  <p className="mt-1.5 font-mono num text-xs text-muted">
                    {spec.material ? `${formatMaterialVolume(spec.material.volumeL, spec.material.state, sys)} ${spec.material.name}${isBulk(spec) ? (spec.material.state === 'solid' ? ' · dump-truck load' : ' · tanker fill') : ''}` : formatDims(spec.dims, sys)} · {formatWeight(spec.weightKg, sys)} · {TEMP_LABELS[spec.temp]}
                    {spec.hazmat ? ` · ${spec.hazmat.unNumber} (class ${spec.hazmat.hazClass})` : ''}
                  </p>
                )}
                {r.kind === 'custom' && (
                  <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-6">
                    <Field label="Length">
                      <LengthInput metres={r.dims.l} onChange={(l) => patchRow(r.key, { dims: { ...r.dims, l } })} unit={lenUnit} aria-label="Length" />
                    </Field>
                    <Field label="Width">
                      <LengthInput metres={r.dims.w} onChange={(w) => patchRow(r.key, { dims: { ...r.dims, w } })} unit={lenUnit} aria-label="Width" />
                    </Field>
                    <Field label="Height">
                      <LengthInput metres={r.dims.h} onChange={(h) => patchRow(r.key, { dims: { ...r.dims, h } })} unit={lenUnit} aria-label="Height" />
                    </Field>
                    <Field label="Weight / unit">
                      <WeightInput kg={r.weightKg} onChange={(weightKg) => patchRow(r.key, { weightKg })} unit={wUnit} aria-label="Weight per unit" />
                    </Field>
                    <Field label="Temperature">
                      <Select<TempClass> value={r.temp} onChange={(temp) => patchRow(r.key, { temp })} options={(['ambient', 'chilled', 'frozen'] as const).map((t) => ({ value: t, label: TEMP_LABELS[t] }))} aria-label="Temperature" />
                    </Field>
                    <div className="pb-1.5">
                      <Toggle checked={r.stackable} onChange={(stackable) => patchRow(r.key, { stackable })} label="Stackable" />
                    </div>
                  </div>
                )}
                {tried && errors[i] && <p className="mt-1.5 text-xs text-bad">{errors[i]}</p>}
                {warning && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-warn">
                    <TriangleAlert className="h-3.5 w-3.5" /> {warning}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRows((rs) => [...rs, templateRow()])}>
            From template
          </Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRows((rs) => [...rs, customRow()])}>
            Quick custom item
          </Button>
        </div>
      </div>
    </Modal>
  );
}
