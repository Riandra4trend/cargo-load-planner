import { BookmarkPlus, Check, ChevronDown, ChevronUp, CircleAlert, Package, PackagePlus, RotateCcw, Scale, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PACKAGING_KINDS, PACKAGING_PRESETS } from '../../data/packaging';
import { makeSpec } from '../../data/seed';
import { TEMP_COLORS, TEMP_LABELS } from '../../domain/colors';
import { isBulk, unitIdOf } from '../../domain/geometry';
import { CUSTOM_MATERIAL_ID, materialColor, materialDef, materialWeightKg, maxFillPct, type MaterialDef } from '../../domain/materials';
import { HAZMAT_CLASSES, HAZMAT_CLASS_NAMES } from '../../domain/settings';
import type { ItemSpec, ItemTemplate, MaterialContents, MaterialState, PackagingKind, PackingGroup, Plan, Shape, TempClass, UnitSystem } from '../../domain/types';
import {
  formatArea,
  formatDensity,
  formatLength,
  formatMaterialDensity,
  formatMaterialVolume,
  formatNumber,
  formatVolume,
  formatWeight,
  itemLengthUnit,
  LENGTH_UNITS,
  WEIGHT_UNITS,
  weightUnit,
  type LengthUnit,
  type WeightUnit,
} from '../../domain/units';
import { ItemPreview } from '../../scene/ItemPreview';
import { useStore, type ItemEditorRequest } from '../../state/store';
import { Button } from '../common/Button';
import { Chip, ColorDot } from '../common/Chip';
import { Field, inputClass, LengthInput, MaterialDensityInput, MaterialVolumeInput, NumberInput, SegmentedControl, Select, TextInput, Toggle, WeightInput } from '../common/fields';
import { Modal } from '../common/Modal';
import { bestLegalFill, checkDraft, containerCapacityL, deriveItem, hasErrors, materialTareKg, presetVehicleList, vehicleSuits, type DraftIssues, type LineDraft, type VehicleFit } from './itemChecks';
import { MaterialBadges, MaterialPicker } from './MaterialPicker';
import { placeOnVehicle, targetVehicleId } from './placement';
import { StopPicker } from './StopPicker';
import { TemplatePicker, useAllTemplates } from './TemplatePicker';

const DEFAULT_PALLET_HEIGHT = 0.144;
/** Default volume of a new bulk fill or load, litres (5,000 L / 5 m³). */
const DEFAULT_BULK_L = 5000;

type ContainerKind = 'drum' | 'ibc' | 'jerrycan';
type MaterialMode = ContainerKind | 'other' | 'bulk';
const CONTAINERS: ContainerKind[] = ['drum', 'ibc', 'jerrycan'];
const CONTAINER_NAMES: Record<ContainerKind, string> = { drum: 'Drum', ibc: 'IBC', jerrycan: 'Jerrycan' };
const isContainer = (k: PackagingKind): k is ContainerKind => (CONTAINERS as PackagingKind[]).includes(k);

function materialModeOf(spec: ItemSpec): MaterialMode {
  if (isBulk(spec)) return 'bulk';
  return isContainer(spec.packaging) ? spec.packaging : 'other';
}

/** Container weight of a material unit: preset containers use the preset tare, bulk fills none, other containers the user's tare. */
function tareFor(spec: ItemSpec, otherTareKg: number): number {
  if (isBulk(spec)) return 0;
  return isContainer(spec.packaging) ? PACKAGING_PRESETS[spec.packaging].tareKg : otherTareKg;
}

/** Keeps a material spec's gross weight = volume × density + container. */
function syncWeight(spec: ItemSpec, otherTareKg: number): ItemSpec {
  return spec.material ? { ...spec, weightKg: materialWeightKg(spec.material) + tareFor(spec, otherTareKg) } : spec;
}

/** Hazmat, food and temperature defaults a library material brings along. */
function materialPrefill(def: MaterialDef): Partial<ItemSpec> {
  return { hazmat: def.hazmat ? { ...def.hazmat } : undefined, isFood: def.isFood, temp: def.temp };
}

/** A loose bulk fill: no box, handling or orientation (it takes the shape of its compartment or body). */
function bulkPatch(material: MaterialContents): Partial<ItemSpec> {
  return {
    packaging: 'bulk',
    rotation: 'none',
    dims: { l: 1, w: 1, h: 1 },
    palletHeight: 0,
    shape: 'box',
    stackable: false,
    maxLoadOnTopKg: 0,
    maxStackLayers: 1,
    fragile: false,
    keepUpright: true,
    cogOffset: { x: 0, y: 0, z: 0 },
    material: { ...material, volumeL: Math.max(material.volumeL, DEFAULT_BULK_L), containerCapacityL: undefined },
  };
}

function blankSpec(): ItemSpec {
  const eur = PACKAGING_PRESETS['eur-pallet'];
  return makeSpec({ name: '', dims: { l: 1.2, w: 0.8, h: 1.344 }, weightKg: eur.tareKg, packaging: 'eur-pallet', palletHeight: eur.palletHeight });
}

function initialDraft(request: ItemEditorRequest, plan: Plan, templates: ItemTemplate[]): LineDraft | null {
  if (request.mode === 'edit') {
    const line = plan.lines.find((l) => l.id === request.lineId);
    if (!line) return null;
    const { id: _id, ...rest } = structuredClone(line);
    return rest;
  }
  const template = templates.find((t) => t.id === request.templateId);
  const firstStop = [...plan.stops].sort((a, b) => a.sequence - b.sequence)[0];
  return {
    spec: template ? structuredClone(template.spec) : blankSpec(),
    quantity: 1,
    contents: template?.contents,
    stopId: request.stopId ?? firstStop?.id ?? '',
    priority: 'normal',
  };
}

const toDisplayTemp = (c: number, sys: UnitSystem) => (sys === 'metric' ? `${formatNumber(c, 0)} °C` : `${formatNumber((c * 9) / 5 + 32, 0)} °F`);
/** Material volume for display: litres whole from 100 L up, gallons and m³ / yd³ to one decimal. */
const vol = (litres: number, state: MaterialState, sys: UnitSystem) => formatMaterialVolume(litres, state, sys, state === 'liquid' && sys === 'metric' && litres >= 100 ? 0 : 1);
/** Material weight for display: dry bulk in tonnes (metric) like "19.0 t", liquids in kg / lb. */
const matWeight = (kg: number, state: MaterialState, sys: UnitSystem) => (state === 'solid' && sys === 'metric' ? formatWeight(kg, sys, { unit: 't', digits: 1 }) : formatWeight(kg, sys));

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-line pb-4 last:border-b-0">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function FitList({ title, fits, empty }: { title: string; fits: VehicleFit[]; empty: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-ink-soft">{title}</div>
      {fits.length === 0 && <p className="text-xs text-muted">{empty}</p>}
      <ul className="flex flex-col gap-0.5">
        {fits.map((f) => (
          <li key={f.id} className="flex items-start gap-1.5 text-xs">
            {f.fits ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" />}
            <span className={f.fits ? 'text-ink' : 'text-muted'}>
              {f.name}
              {f.detail && <span className="font-mono text-ink-soft"> · {f.detail}</span>}
              {f.reason && <span className={f.fits ? 'text-warn' : 'text-bad'}> · {f.reason}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IssueList({ issues }: { issues: DraftIssues }) {
  const fieldErrors = Object.values(issues.errors);
  if (!fieldErrors.length && !issues.blocking.length && !issues.warnings.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-ok">
        <Check className="h-3.5 w-3.5" /> Ready to save
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {[...issues.blocking, ...fieldErrors].map((e) => (
        <li key={e} className="flex items-start gap-1.5 text-bad">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {e}
        </li>
      ))}
      {issues.warnings.map((w) => (
        <li key={w} className="flex items-start gap-1.5 text-warn">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-canvas px-2.5 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="font-mono num text-sm font-semibold text-ink">{value}</div>
      {sub && <div className="font-mono num text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

/** Wrapper that resolves the request (closing it when the edited line no longer exists). */
export function ItemEditor({ request }: { request: ItemEditorRequest }) {
  const templates = useAllTemplates();
  const [initial] = useState(() => initialDraft(request, useStore.getState().plan, templates));
  const closeDialog = useStore((s) => s.closeDialog);
  useEffect(() => {
    if (!initial) closeDialog('itemEditor');
  }, [initial, closeDialog]);
  if (!initial) return null;
  return <ItemEditorForm request={request} initial={initial} />;
}

function ItemEditorForm({ request, initial }: { request: ItemEditorRequest; initial: LineDraft }) {
  const plan = useStore((s) => s.plan);
  const sys = plan.settings.units;
  const closeDialog = useStore((s) => s.closeDialog);
  const openDialog = useStore((s) => s.openDialog);
  const addLine = useStore((s) => s.addLine);
  const updateLine = useStore((s) => s.updateLine);
  const saveTemplate = useStore((s) => s.saveTemplate);
  const toast = useStore((s) => s.toast);

  const [draft, setDraft] = useState<LineDraft>(initial);
  const [lenUnit, setLenUnit] = useState<LengthUnit>(itemLengthUnit(sys));
  const [wUnit, setWUnit] = useState<WeightUnit>(weightUnit(sys));
  const [showTemplates, setShowTemplates] = useState(false);
  const [showMaterials, setShowMaterials] = useState(false);
  const [touched, setTouched] = useState(request.mode === 'edit');
  /** Container weight of "Other container" materials (preset containers use their preset tare). */
  const [otherTareKg, setOtherTareKg] = useState(() => materialTareKg(initial.spec));

  const { spec } = draft;
  const material = spec.material;
  const bulk = isBulk(spec);
  const solid = material?.state === 'solid';
  const derived = useMemo(() => deriveItem(spec, plan), [spec, plan]);
  const issues = useMemo(() => checkDraft(draft, plan, derived), [draft, plan, derived]);
  const invalid = hasErrors(issues);
  const err = (k: keyof DraftIssues['errors']) => (touched ? issues.errors[k] : undefined);
  /** Dry bulk: the largest legal load among the plan's dump trucks (or the dump-truck presets when the plan has none). */
  const legal = useMemo(() => {
    if (!bulk || !material || material.state !== 'solid') return null;
    const planTrucks = plan.vehicles.filter((v) => vehicleSuits(spec, v));
    let best: { litres: number; limitedBy: string; vehicle: string } | null = null;
    for (const v of planTrucks.length ? planTrucks : presetVehicleList().filter((x) => vehicleSuits(spec, x))) {
      const fill = bestLegalFill(v, material);
      if (fill && (!best || fill.litres > best.litres)) best = { litres: fill.litres, limitedBy: fill.limitedBy, vehicle: v.name };
    }
    return best;
  }, [bulk, material, plan, spec]);

  const close = useCallback(() => closeDialog('itemEditor'), [closeDialog]);
  const setSpec = (patch: Partial<ItemSpec>) => setDraft((d) => ({ ...d, spec: syncWeight({ ...d.spec, ...patch }, otherTareKg) }));
  const setMaterial = (patch: Partial<MaterialContents>) => setDraft((d) => (d.spec.material ? { ...d, spec: syncWeight({ ...d.spec, material: { ...d.spec.material, ...patch } }, otherTareKg) } : d));
  const set = (patch: Partial<LineDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const palletized = spec.palletHeight > 0;
  const goodsH = spec.dims.h - spec.palletHeight;
  const setDims = (l: number, w: number, goods: number) => setSpec({ dims: { l, w, h: goods + spec.palletHeight } });

  const applyTemplate = (t: ItemTemplate) => {
    setDraft((d) => ({ ...d, spec: structuredClone(t.spec), contents: t.contents }));
    setOtherTareKg(materialTareKg(t.spec));
    setShowTemplates(false);
    toast(`Prefilled from “${t.spec.name}”`, 'info');
  };

  const applyPackaging = (kind: PackagingKind) => {
    const next = PACKAGING_PRESETS[kind];
    if (material) {
      // Materials: the weight follows the container; preset containers start at their nominal fill.
      const volumeL = next.nominalL ?? material.volumeL;
      setSpec({ packaging: kind, ...(next.dims ? { dims: { ...next.dims }, palletHeight: next.palletHeight, shape: next.shape } : {}), material: { ...material, volumeL, containerCapacityL: isContainer(kind) ? undefined : material.containerCapacityL } });
      return;
    }
    const prev = PACKAGING_PRESETS[spec.packaging];
    const weightKg = Math.max(next.tareKg, spec.weightKg - prev.tareKg + next.tareKg);
    if (!next.dims) return setSpec({ packaging: kind, weightKg });
    setSpec({ packaging: kind, dims: { ...next.dims }, palletHeight: next.palletHeight, shape: next.shape, weightKg });
  };

  const setShape = (shape: Shape) => {
    if (shape === 'cylinder-upright') setSpec({ shape, dims: { ...spec.dims, w: spec.dims.l }, rotation: spec.rotation === 'any' ? 'yaw' : spec.rotation, keepUpright: true });
    else if (shape === 'cylinder-lying') setSpec({ shape, dims: { ...spec.dims, h: spec.dims.w + spec.palletHeight } });
    else setSpec({ shape });
  };

  const setPalletized = (on: boolean) => {
    const ph = on ? PACKAGING_PRESETS[spec.packaging].palletHeight || DEFAULT_PALLET_HEIGHT : 0;
    setSpec({ palletHeight: ph, dims: { ...spec.dims, h: goodsH + ph } });
  };

  const setPalletHeight = (ph: number) => setSpec({ palletHeight: ph, dims: { ...spec.dims, h: goodsH + ph } });

  // Materials ---------------------------------------------------------------------------------------

  const setMaterialOn = (on: boolean) => {
    if (!on) {
      // Back to manual weight entry; a bulk fill becomes an ordinary custom unit.
      setDraft((d) => {
        const { material: _material, ...rest } = d.spec;
        const wasBulk = isBulk(d.spec);
        return { ...d, spec: { ...rest, ...(wasBulk ? { packaging: 'custom' as const, rotation: 'yaw' as const } : {}) } };
      });
      return;
    }
    const def = materialDef('water')!;
    const kind: ContainerKind = isContainer(spec.packaging) ? spec.packaging : 'drum';
    const p = PACKAGING_PRESETS[kind];
    setSpec({
      packaging: kind,
      dims: { ...p.dims! },
      shape: p.shape,
      palletHeight: 0,
      name: spec.name.trim() ? spec.name : def.name,
      ...materialPrefill(def),
      material: { materialId: def.id, name: def.name, state: def.state, densityKgPerL: def.densityKgPerL, volumeL: p.nominalL! },
    });
    setShowMaterials(true);
  };

  /** Dry bulk only travels loose (dump truck) or in an "other" container (e.g. a big bag), not in drums, IBCs or jerrycans. */
  const forState = (next: MaterialContents): Partial<ItemSpec> => (next.state === 'solid' && isContainer(spec.packaging) ? bulkPatch(next) : { material: next });

  const pickMaterial = (materialId: string) => {
    if (!material) return;
    setShowMaterials(false);
    const keepName = spec.name.trim() !== '' && spec.name !== material.name;
    if (materialId === CUSTOM_MATERIAL_ID) {
      const name = material.materialId === CUSTOM_MATERIAL_ID ? material.name : 'Custom material';
      setSpec({ name: keepName ? spec.name : name, material: { ...material, materialId, name } });
      return;
    }
    const def = materialDef(materialId)!;
    const next: MaterialContents = { ...material, materialId, name: def.name, state: def.state, densityKgPerL: def.densityKgPerL };
    setSpec({ name: keepName ? spec.name : def.name, ...materialPrefill(def), ...forState(next) });
  };

  const setCustomState = (state: MaterialState) => {
    if (!material || material.state === state) return;
    setSpec(forState({ ...material, state }));
  };

  const setMode = (mode: MaterialMode) => {
    if (!material || mode === materialModeOf(spec)) return;
    const fromBulk = bulk;
    if (mode === 'bulk') {
      setSpec(bulkPatch(material));
    } else if (mode === 'other') {
      setSpec({ packaging: 'custom', ...(fromBulk ? { rotation: 'yaw' as const, dims: { l: 1.0, w: 1.0, h: 1.0 }, material: { ...material, volumeL: Math.min(material.volumeL, 1000) } } : {}) });
    } else {
      const p = PACKAGING_PRESETS[mode];
      setSpec({
        packaging: mode,
        dims: { ...p.dims! },
        shape: p.shape,
        palletHeight: 0,
        ...(fromBulk ? { rotation: 'yaw' as const } : {}),
        material: { ...material, volumeL: p.nominalL!, containerCapacityL: undefined },
      });
    }
  };

  const setOtherTare = (kg: number) => {
    setOtherTareKg(kg);
    setDraft((d) => ({ ...d, spec: syncWeight(d.spec, kg) }));
  };

  // Save --------------------------------------------------------------------------------------------

  const finalLine = (): LineDraft => ({
    ...draft,
    contents: draft.contents?.trim() || undefined,
    spec: {
      ...spec,
      name: spec.name.trim(),
      notes: spec.notes?.trim() || undefined,
      hazmat: spec.hazmat ? { ...spec.hazmat, unNumber: spec.hazmat.unNumber.trim().toUpperCase() } : undefined,
      material: material ? { ...material, name: material.name.trim() } : undefined,
    },
  });

  const save = (place: boolean) => {
    setTouched(true);
    if (invalid) return;
    const line = finalLine();
    if (request.mode === 'edit' && request.lineId) {
      const { spec: nextSpec, quantity, contents, stopId, priority, timeWindow } = line;
      updateLine(request.lineId, { spec: nextSpec, quantity, contents, stopId, priority, timeWindow });
      toast(`Updated ${nextSpec.name} (${quantity} unit${quantity === 1 ? '' : 's'})`, 'success');
    } else {
      const id = addLine(line);
      const vehicleId = place ? targetVehicleId(line.spec) : undefined;
      if (place && !vehicleId) {
        const needed = !isBulk(line.spec) ? 'box or flatbed vehicle' : line.spec.material?.state === 'solid' ? 'dump truck' : 'tanker';
        toast(`Added ${line.spec.name} as unplaced: no ${needed} in this plan`, 'error');
      } else if (vehicleId) {
        const placed = placeOnVehicle(
          Array.from({ length: line.quantity }, (_, i) => unitIdOf(id, i)),
          vehicleId,
        );
        const vehicleName = useStore.getState().plan.vehicles.find((v) => v.id === vehicleId)?.name ?? 'the vehicle';
        if (placed === line.quantity) toast(`Placed ${placed} of ${line.quantity} on ${vehicleName}`, 'success');
        else toast(`Placed ${placed} of ${line.quantity} on ${vehicleName}; the rest stay unplaced (no legal space)`, placed ? 'info' : 'error');
      } else {
        toast(`Added ${line.spec.name} as unplaced`, 'success');
      }
    }
    close();
  };

  const saveAsTemplate = () => {
    setTouched(true);
    if (issues.errors.name || issues.errors.dims || issues.errors.weight || issues.errors.volume || issues.errors.density) return;
    const line = finalLine();
    saveTemplate(line.spec, line.contents);
    toast(`Saved “${line.spec.name}” to the template library`, 'success');
  };

  const lengthField = (label: string, metres: number, onChange: (m: number) => void, error?: string) => (
    <Field label={label} error={error}>
      <LengthInput metres={metres} onChange={onChange} unit={lenUnit} aria-label={label} />
    </Field>
  );

  const cogField = (axis: 'x' | 'y' | 'z', label: string, half: number) => (
    <Field label={label} hint={`± ${formatLength(half, sys, { unit: lenUnit })}`}>
      <LengthInput
        metres={spec.cogOffset[axis]}
        onChange={(m) => setSpec({ cogOffset: { ...spec.cogOffset, [axis]: m } })}
        unit={lenUnit}
        min={Number.NEGATIVE_INFINITY}
        aria-label={`COG offset ${axis}`}
      />
    </Field>
  );

  const temps: TempClass[] = ['ambient', 'chilled', 'frozen'];
  const range = plan.settings.tempRanges[spec.temp];
  const totalKg = spec.weightKg * draft.quantity;
  const tare = PACKAGING_PRESETS[spec.packaging].tareKg;
  const mode = material ? materialModeOf(spec) : null;
  const materialKg = material ? materialWeightKg(material) : 0;
  const containerKg = material ? tareFor(spec, otherTareKg) : 0;
  const libraryDef = material ? materialDef(material.materialId) : undefined;
  const cap = material && !bulk ? containerCapacityL(spec) : undefined;
  const fillPct = material ? maxFillPct(material.materialId, material.state) : 0;
  const state: MaterialState = material?.state ?? 'liquid';
  const unitWord = bulk ? (solid ? 'load' : 'fill') : 'unit';

  const footer = (
    <>
      <div className="mr-auto text-xs text-muted">
        {invalid && touched ? <span className="text-bad">Fix the highlighted issues to save</span> : request.mode === 'edit' ? 'Changes apply to every unit of this line' : 'New units start unplaced unless you use Save & place'}
      </div>
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
      <Button icon={<BookmarkPlus className="h-4 w-4" />} onClick={saveAsTemplate}>
        Save as template
      </Button>
      {request.mode === 'create' && (
        <Button icon={<PackagePlus className="h-4 w-4" />} onClick={() => save(true)} disabled={touched && invalid}>
          Save &amp; place
        </Button>
      )}
      <Button variant="primary" onClick={() => save(false)} disabled={touched && invalid}>
        Save
      </Button>
    </>
  );

  const unitSelects = (
    <div className="flex items-center gap-1.5 text-xs text-muted">
      Units
      {!bulk && (
        <div className="w-[4.5rem]">
          <Select value={lenUnit} onChange={setLenUnit} options={LENGTH_UNITS.map((u) => ({ value: u, label: u }))} className="h-7 text-xs" aria-label="Length unit" />
        </div>
      )}
      <div className="w-[4.5rem]">
        <Select value={wUnit} onChange={setWUnit} options={WEIGHT_UNITS.map((u) => ({ value: u, label: u }))} className="h-7 text-xs" aria-label="Weight unit" />
      </div>
    </div>
  );

  return (
    <Modal open title={request.mode === 'edit' ? `Edit item · ${initial.spec.name}` : 'New item'} icon={<Package />} onClose={close} width="max-w-5xl" footer={footer}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4" onBlur={() => setTouched(true)}>
          <Section
            title="Start from"
            right={
              <Button size="sm" variant="ghost" icon={showTemplates ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} onClick={() => setShowTemplates((v) => !v)} aria-expanded={showTemplates}>
                {showTemplates ? 'Hide templates' : 'Choose template'}
              </Button>
            }
          >
            {showTemplates && <TemplatePicker onPick={applyTemplate} />}
            {!bulk && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Packaging preset" hint={PACKAGING_PRESETS[spec.packaging].note}>
                  <Select
                    value={spec.packaging}
                    onChange={applyPackaging}
                    options={PACKAGING_KINDS.filter((k) => k !== 'bulk').map((k) => ({ value: k, label: PACKAGING_PRESETS[k].label }))}
                    aria-label="Packaging preset"
                  />
                </Field>
                <Field label="Shape">
                  <SegmentedControl<Shape>
                    label="Shape"
                    size="sm"
                    value={spec.shape}
                    onChange={setShape}
                    options={[
                      { value: 'box', label: 'Box' },
                      { value: 'cylinder-upright', label: 'Drum', title: 'Upright cylinder' },
                      { value: 'cylinder-lying', label: 'Roll', title: 'Lying cylinder (roll, coil, reel)' },
                    ]}
                  />
                </Field>
              </div>
            )}
          </Section>

          <Section
            title="Material"
            right={
              <Button size="sm" variant="ghost" icon={<Scale className="h-3.5 w-3.5" />} onClick={() => openDialog('materials', true)}>
                Material weights
              </Button>
            }
          >
            <Toggle checked={!!material} onChange={setMaterialOn} label="Liquid / bulk material" hint="Weight is calculated from volume × density (+ container)" />
            {material && mode && (
              <>
                <div className="flex flex-col gap-2 rounded-lg border border-line p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <ColorDot color={materialColor(material.materialId, material.state)} size={12} className="ring-1 ring-black/10" />
                    <span className="text-sm font-medium text-ink">{libraryDef ? libraryDef.name : 'Custom material'}</span>
                    <Chip>{solid ? 'Dry bulk' : 'Liquid'}</Chip>
                    {libraryDef && <span className="font-mono num text-xs text-muted">{formatMaterialDensity(libraryDef.densityKgPerL, libraryDef.state, sys)}</span>}
                    {libraryDef && <MaterialBadges def={libraryDef} />}
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setShowMaterials((v) => !v)} aria-expanded={showMaterials}>
                      {showMaterials ? 'Close list' : 'Change material'}
                    </Button>
                  </div>
                  {showMaterials && <MaterialPicker value={material.materialId} onPick={pickMaterial} sys={sys} />}
                  {libraryDef?.note && !showMaterials && <p className="text-[11px] text-muted">{libraryDef.note}</p>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {!libraryDef && (
                    <>
                      <Field label="Material name" error={err('materialName')}>
                        <TextInput value={material.name} onChange={(e) => setMaterial({ name: e.target.value })} placeholder="e.g. Glycerine or Fly ash" aria-label="Material name" />
                      </Field>
                      <Field label="State">
                        <SegmentedControl<MaterialState>
                          label="Material state"
                          size="sm"
                          value={material.state}
                          onChange={setCustomState}
                          options={[
                            { value: 'liquid', label: 'Liquid' },
                            { value: 'solid', label: 'Dry bulk' },
                          ]}
                        />
                      </Field>
                    </>
                  )}
                  <Field
                    label={solid ? 'Bulk density' : 'Density'}
                    error={err('density')}
                    hint={
                      libraryDef && Math.abs(libraryDef.densityKgPerL - material.densityKgPerL) > 1e-9
                        ? `Library value ${formatMaterialDensity(libraryDef.densityKgPerL, libraryDef.state, sys)}`
                        : libraryDef
                          ? solid
                            ? 'Typical loose density; override for your load'
                            : 'Typical at 15 °C; override for your product'
                          : undefined
                    }
                  >
                    <div className="flex gap-1">
                      <div className="min-w-0 flex-1">
                        <MaterialDensityInput kgPerL={material.densityKgPerL} onChange={(densityKgPerL) => setMaterial({ densityKgPerL })} state={material.state} sys={sys} min={0} aria-label="Material density" />
                      </div>
                      {libraryDef && Math.abs(libraryDef.densityKgPerL - material.densityKgPerL) > 1e-9 && (
                        <Button size="sm" variant="ghost" className="h-9" title="Reset to the library density" aria-label="Reset density" onClick={() => setMaterial({ densityKgPerL: libraryDef.densityKgPerL })}>
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </Field>
                </div>

                <Field label="How it travels">
                  <SegmentedControl<MaterialMode>
                    label="How it travels"
                    size="sm"
                    value={mode}
                    onChange={setMode}
                    options={
                      solid
                        ? [
                            { value: 'bulk', label: 'Bulk (dump truck)', title: 'One dump-body load per unit' },
                            { value: 'other', label: 'Other container', title: 'e.g. a big bag: set its weight and capacity' },
                          ]
                        : [
                            ...CONTAINERS.map((k) => ({ value: k, label: `${CONTAINER_NAMES[k]} ${formatMaterialVolume(PACKAGING_PRESETS[k].nominalL!, 'liquid', sys, sys === 'metric' ? 0 : 1)}`, title: PACKAGING_PRESETS[k].note })),
                            { value: 'other' as const, label: 'Other container', title: 'Your own container: set its weight and capacity' },
                            { value: 'bulk' as const, label: 'Bulk (tanker)', title: 'One tanker compartment fill per unit' },
                          ]
                    }
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field
                    label={`Volume per ${unitWord}`}
                    error={err('volume')}
                    hint={
                      bulk
                        ? solid
                          ? 'Level with the body sides (struck)'
                          : `Max fill ${fillPct} % of the compartment`
                        : cap
                          ? `Capacity ${vol(cap, state, sys)} · max fill ${fillPct} % = ${vol((cap * fillPct) / 100, state, sys)}`
                          : 'Container capacity not set'
                    }
                  >
                    <MaterialVolumeInput litres={material.volumeL} onChange={(volumeL) => setMaterial({ volumeL })} state={material.state} sys={sys} aria-label="Material volume" />
                  </Field>
                  {mode === 'other' && (
                    <>
                      <Field label="Container weight" hint={solid ? 'Empty big bag / container' : 'Empty container / pallet'}>
                        <WeightInput kg={otherTareKg} onChange={setOtherTare} unit={wUnit} aria-label="Container weight" />
                      </Field>
                      <Field label="Container capacity" hint="Brim capacity; 0 = not checked">
                        <MaterialVolumeInput litres={material.containerCapacityL ?? 0} onChange={(l) => setMaterial({ containerCapacityL: l > 0 ? l : undefined })} state={material.state} sys={sys} aria-label="Container capacity" />
                      </Field>
                    </>
                  )}
                </div>
                <p className="rounded-lg bg-canvas px-2.5 py-2 font-mono num text-xs text-ink-soft" aria-label="Weight calculation">
                  {vol(material.volumeL, state, sys)} × {formatMaterialDensity(material.densityKgPerL, state, sys)} = {matWeight(materialKg, state, sys)}
                  {bulk ? '' : ` + container ${formatWeight(containerKg, sys)} = `}
                  {!bulk && <span className="font-semibold text-ink">{formatWeight(spec.weightKg, sys)}</span>} per {unitWord}
                </p>
              </>
            )}
          </Section>

          <Section title="Identity">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Name" error={err('name')} className="col-span-2">
                <TextInput value={spec.name} onChange={(e) => setSpec({ name: e.target.value })} placeholder="e.g. Apparel cartons" autoFocus={request.mode === 'create'} aria-invalid={!!err('name')} />
              </Field>
              <Field label="SKU">
                <TextInput value={spec.sku} onChange={(e) => setSpec({ sku: e.target.value })} />
              </Field>
              <Field label="Category">
                <TextInput value={spec.category} onChange={(e) => setSpec({ category: e.target.value })} />
              </Field>
              <Field label="Origin">
                <TextInput value={spec.origin} onChange={(e) => setSpec({ origin: e.target.value })} />
              </Field>
              <Field label="Colour override" hint="Default: customer colour">
                <div className="flex items-center gap-2">
                  <Toggle checked={!!spec.color} onChange={(on) => setSpec({ color: on ? '#8E7CC3' : undefined })} label={spec.color ? 'Custom' : 'Off'} />
                  {spec.color && <input type="color" value={spec.color} onChange={(e) => setSpec({ color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-line bg-card" aria-label="Item colour" />}
                </div>
              </Field>
              <Field label="Notes" className="col-span-2 sm:col-span-3">
                <textarea value={spec.notes ?? ''} onChange={(e) => setSpec({ notes: e.target.value })} rows={2} className={`${inputClass} h-auto py-1.5`} />
              </Field>
            </div>
          </Section>

          <Section title={bulk ? 'Quantity' : 'Size & weight'} right={unitSelects}>
            {!bulk && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {spec.shape === 'box' && (
                    <>
                      {lengthField('Length', spec.dims.l, (m) => setDims(m, spec.dims.w, goodsH), err('dims'))}
                      {lengthField('Width', spec.dims.w, (m) => setDims(spec.dims.l, m, goodsH))}
                      {lengthField(palletized ? 'Goods height' : 'Height', goodsH, (m) => setDims(spec.dims.l, spec.dims.w, m))}
                    </>
                  )}
                  {spec.shape === 'cylinder-upright' && (
                    <>
                      {lengthField('Diameter', spec.dims.l, (m) => setDims(m, m, goodsH), err('dims'))}
                      {lengthField(palletized ? 'Goods height' : 'Height', goodsH, (m) => setDims(spec.dims.l, spec.dims.w, m))}
                    </>
                  )}
                  {spec.shape === 'cylinder-lying' && (
                    <>
                      {lengthField('Length (axis)', spec.dims.l, (m) => setDims(m, spec.dims.w, goodsH), err('dims'))}
                      {lengthField('Diameter', spec.dims.w, (m) => setDims(spec.dims.l, m, m))}
                    </>
                  )}
                </div>
                <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3">
                  <Toggle checked={palletized} onChange={setPalletized} label="Palletized" hint="Total height = goods + pallet" />
                  {palletized && (
                    <Field label="Pallet height" error={err('palletHeight')}>
                      <LengthInput metres={spec.palletHeight} onChange={setPalletHeight} unit={lenUnit} aria-label="Pallet height" />
                    </Field>
                  )}
                  {palletized && (
                    <div className="text-xs text-muted">
                      Total height
                      <div className="font-mono num text-sm font-semibold text-ink">{formatLength(spec.dims.h, sys, { unit: lenUnit })}</div>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field
                label={material ? `Weight per ${unitWord} (calculated)` : 'Weight per unit (gross)'}
                error={err('weight')}
                hint={material ? `Volume × density${bulk ? '' : ' + container'}` : tare ? `Incl. ≈ ${formatWeight(tare, sys)} packaging` : 'Including packaging'}
              >
                <WeightInput kg={spec.weightKg} onChange={(kg) => setSpec({ weightKg: kg })} unit={wUnit} readOnly={!!material} disabled={!!material} aria-label="Weight per unit" />
              </Field>
              <Field
                label={bulk ? (solid ? 'Loads (one dump body each)' : 'Fills (one compartment each)') : 'Quantity'}
                error={err('quantity')}
                hint={`Total ${formatWeight(totalKg, sys)}${material ? ` · ${vol(material.volumeL * draft.quantity, state, sys)}` : ''}`}
              >
                <NumberInput value={draft.quantity} onChange={(n) => set({ quantity: n })} digits={0} min={1} aria-label="Quantity" />
              </Field>
              <Field label="Contents" hint={material ? 'e.g. order or batch reference' : 'e.g. 480 pcs'}>
                <TextInput value={draft.contents ?? ''} onChange={(e) => set({ contents: e.target.value })} />
              </Field>
            </div>
          </Section>

          {!bulk && (
            <Section title="Centre of gravity offset">
              <div className="grid grid-cols-3 gap-3">
                {cogField('x', 'Along length', spec.dims.l / 2)}
                {cogField('y', 'Across width', spec.dims.w / 2)}
                {cogField('z', 'Vertical', spec.dims.h / 2)}
              </div>
              {err('cog') && <p className="text-xs text-bad">{err('cog')}</p>}
            </Section>
          )}

          {!bulk && (
            <Section title="Handling">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Toggle checked={spec.stackable && !spec.fragile} disabled={spec.fragile} onChange={(on) => setSpec({ stackable: on, maxStackLayers: on ? Math.max(2, spec.maxStackLayers) : 1, maxLoadOnTopKg: on ? spec.maxLoadOnTopKg || spec.weightKg : 0 })} label="Stackable" hint="Others may go on top" />
                <Field label="Max load on top">
                  <WeightInput kg={spec.maxLoadOnTopKg} onChange={(kg) => setSpec({ maxLoadOnTopKg: kg })} unit={wUnit} disabled={!spec.stackable || spec.fragile} aria-label="Max load on top" />
                </Field>
                <Field label="Max stack layers" error={err('maxStackLayers')}>
                  <NumberInput value={spec.maxStackLayers} onChange={(n) => setSpec({ maxStackLayers: n })} digits={0} min={1} aria-label="Max stack layers" />
                </Field>
                <Toggle checked={spec.fragile} onChange={(on) => setSpec({ fragile: on, ...(on ? { stackable: false, maxLoadOnTopKg: 0 } : {}) })} label="Fragile" hint="Nothing on top" />
                <Toggle checked={spec.keepUpright || spec.shape === 'cylinder-upright'} disabled={spec.shape === 'cylinder-upright'} onChange={(on) => setSpec({ keepUpright: on })} label="Keep upright" hint="Height axis stays vertical" />
                <Field label="Rotation" hint={spec.rotation === 'any' && (spec.keepUpright || spec.shape === 'cylinder-upright') ? 'Upright: only turns about the vertical axis' : undefined}>
                  <SegmentedControl<ItemSpec['rotation']>
                    label="Rotation"
                    size="sm"
                    value={spec.rotation}
                    onChange={(rotation) => setSpec({ rotation })}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'yaw', label: 'Turn', title: 'Around the vertical axis' },
                      { value: 'any', label: 'Any', title: 'All 6 orientations' },
                    ]}
                  />
                </Field>
              </div>
            </Section>
          )}

          <Section title="Temperature & food">
            <div className="grid grid-cols-2 items-end gap-3">
              <Field label="Temperature class" hint={`${toDisplayTemp(range.min, sys)} … ${toDisplayTemp(range.max, sys)}${bulk && !solid && spec.temp !== 'ambient' ? ' · needs an insulated tank' : ''}`}>
                <SegmentedControl<TempClass>
                  label="Temperature class"
                  size="sm"
                  value={spec.temp}
                  onChange={(temp) => setSpec({ temp })}
                  options={temps.map((t) => ({
                    value: t,
                    label: (
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ background: TEMP_COLORS[t] }} />
                        {TEMP_LABELS[t]}
                      </span>
                    ),
                  }))}
                />
              </Field>
              <Toggle checked={spec.isFood} onChange={(isFood) => setSpec({ isFood })} label="Food / feed" hint={bulk && !solid ? 'Needs a food-grade tank' : 'Kept away from toxic (6.1) and infectious (6.2) goods'} />
            </div>
          </Section>

          <Section title="Dangerous goods">
            <Toggle checked={!!spec.hazmat} onChange={(on) => setSpec({ hazmat: on ? { unNumber: 'UN', hazClass: '9' } : undefined })} label="Hazardous material" hint="Segregated per the plan's hazmat matrix" />
            {spec.hazmat && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="UN number" error={err('unNumber')}>
                  <TextInput value={spec.hazmat.unNumber} onChange={(e) => setSpec({ hazmat: { ...spec.hazmat!, unNumber: e.target.value.toUpperCase().replace(/\s/g, '') } })} placeholder="UN3480" maxLength={6} className="font-mono" aria-invalid={!!err('unNumber')} />
                </Field>
                <Field label="Class / division" error={err('hazClass')}>
                  <Select value={spec.hazmat.hazClass} onChange={(hazClass) => setSpec({ hazmat: { ...spec.hazmat!, hazClass } })} options={HAZMAT_CLASSES.map((c) => ({ value: c, label: `${c} · ${HAZMAT_CLASS_NAMES[c]}` }))} aria-label="Hazard class" />
                </Field>
                <Field label="Packing group">
                  <Select<PackingGroup | ''>
                    value={spec.hazmat.packingGroup ?? ''}
                    onChange={(pg) => setSpec({ hazmat: { ...spec.hazmat!, packingGroup: pg || undefined } })}
                    options={[
                      { value: '', label: 'n/a' },
                      { value: 'I', label: 'I (high danger)' },
                      { value: 'II', label: 'II (medium)' },
                      { value: 'III', label: 'III (low)' },
                    ]}
                    aria-label="Packing group"
                  />
                </Field>
                <Field label="Net quantity">
                  <WeightInput kg={spec.hazmat.netQtyKg ?? 0} onChange={(kg) => setSpec({ hazmat: { ...spec.hazmat!, netQtyKg: kg > 0 ? kg : undefined } })} unit={wUnit} aria-label="Net quantity" />
                </Field>
              </div>
            )}
          </Section>

          <Section title="Delivery">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stop" error={err('stop')}>
                <StopPicker value={draft.stopId} onChange={(stopId) => set({ stopId })} invalid={!!err('stop')} />
              </Field>
              <Field label="Priority">
                <SegmentedControl<LineDraft['priority']>
                  label="Priority"
                  size="sm"
                  value={draft.priority}
                  onChange={(priority) => set({ priority })}
                  options={[
                    { value: 'normal', label: 'Normal' },
                    { value: 'urgent', label: 'Urgent' },
                  ]}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3">
              <Toggle checked={!!draft.timeWindow} onChange={(on) => set({ timeWindow: on ? { from: '08:00', to: '12:00' } : undefined })} label="Time window" />
              {draft.timeWindow && (
                <>
                  <Field label="From" error={err('timeWindow')}>
                    <TextInput type="time" value={draft.timeWindow.from} onChange={(e) => set({ timeWindow: { ...draft.timeWindow!, from: e.target.value } })} />
                  </Field>
                  <Field label="To">
                    <TextInput type="time" value={draft.timeWindow.to} onChange={(e) => set({ timeWindow: { ...draft.timeWindow!, to: e.target.value } })} />
                  </Field>
                </>
              )}
            </div>
          </Section>
        </div>

        <aside className="flex flex-col gap-3 md:sticky md:top-0 md:self-start">
          <ItemPreview spec={spec} className="h-60 overflow-hidden rounded-lg border border-line bg-canvas" />
          <div className="grid grid-cols-2 gap-1.5">
            {bulk && material ? (
              <>
                <Stat label={`Volume per ${unitWord}`} value={vol(material.volumeL, state, sys)} sub={draft.quantity > 1 ? `× ${draft.quantity} = ${vol(material.volumeL * draft.quantity, state, sys)}` : undefined} />
                <Stat label={solid ? 'Bulk density' : 'Density'} value={formatMaterialDensity(material.densityKgPerL, state, sys)} />
                <Stat label={`Weight per ${unitWord}`} value={matWeight(spec.weightKg, state, sys)} sub={draft.quantity > 1 ? `total ${matWeight(totalKg, state, sys)}` : undefined} />
                {solid ? (
                  <Stat label="Legal max per load" value={legal ? vol(legal.litres, state, sys) : '-'} sub={legal ? `${legal.vehicle} (${legal.limitedBy.toLowerCase()})` : 'no dump truck'} />
                ) : (
                  <Stat label="Max fill" value={`${fillPct} %`} sub="of compartment capacity" />
                )}
              </>
            ) : (
              <>
                <Stat label="Volume" value={formatVolume(derived.volume, sys)} sub={draft.quantity > 1 ? `× ${draft.quantity} = ${formatVolume(derived.volume * draft.quantity, sys)}` : undefined} />
                <Stat label="Density" value={Number.isFinite(derived.density) ? formatDensity(derived.density, sys) : '-'} />
                <Stat label="Footprint" value={formatArea(derived.footprint, sys)} />
                <Stat label="Loading metres" value={`${formatNumber(derived.ldm, 2)} ldm`} sub={draft.quantity > 1 ? `× ${draft.quantity} = ${formatNumber(derived.ldm * draft.quantity, 2)} ldm` : undefined} />
                <Stat label="Weight" value={formatWeight(spec.weightKg, sys)} sub={draft.quantity > 1 ? `total ${formatWeight(totalKg, sys)}` : undefined} />
                <Stat label="Forklift" value={spec.weightKg > plan.settings.forkliftCapacityKg ? 'Over capacity' : 'OK'} sub={`limit ${formatWeight(plan.settings.forkliftCapacityKg, sys)}`} />
              </>
            )}
          </div>
          <div className="flex flex-col gap-2.5 rounded-lg border border-line p-2.5">
            {bulk && solid ? (
              <>
                <FitList title="Fits in · plan dump trucks" fits={derived.planFits} empty="No dump truck in this plan." />
                <FitList title="Dump-truck presets" fits={derived.presetFits} empty="No dump-truck presets." />
              </>
            ) : bulk ? (
              <>
                <FitList title="Fits in · plan tankers" fits={derived.planFits} empty="No tanker in this plan." />
                <FitList title="Tanker presets" fits={derived.presetFits} empty="No tanker presets." />
              </>
            ) : (
              <>
                <FitList title="Plan vehicles" fits={derived.planFits} empty="No box or flatbed vehicle in this plan." />
                <FitList title="Vehicle presets" fits={derived.presetFits} empty="No vehicle presets." />
              </>
            )}
          </div>
          <div className="rounded-lg border border-line p-2.5">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-ink-soft">
              Checks
              {issues.warnings.length > 0 && <Chip tone="warn">{issues.warnings.length} warning{issues.warnings.length === 1 ? '' : 's'}</Chip>}
            </div>
            <IssueList issues={issues} />
          </div>
        </aside>
      </div>
    </Modal>
  );
}
