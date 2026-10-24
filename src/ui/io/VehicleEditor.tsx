import { ChevronDown, ChevronUp, CircleAlert, Plus, Trash2, TriangleAlert, Truck } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { TEMP_LABELS } from '../../domain/colors';
import { uid } from '../../domain/ids';
import { createCustomVehicle, createVehicle, sliderPositions, VEHICLE_PRESETS, vehicleTareKg } from '../../domain/presets';
import type { AccessSide, ArticStatics, AxleGroup, FuelProfile, Id, Region, TankCompartment, TankSpec, TempClass, UnitSystem, Vehicle, VehicleKind } from '../../domain/types';
import { bigLengthUnit, formatLength, formatLitres, formatMass, formatPercent, kgToLb, L_PER_US_GAL, lbToKg, lPer100kmToMpg, M_PER_FT, weightUnit } from '../../domain/units';
import { curvePeak, loadDistributionCurve } from '../../physics';
import { useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Button, IconButton } from '../common/Button';
import { Field, LengthInput, LitresInput, NumberInput, SegmentedControl, Select, TextInput, Toggle, WeightInput } from '../common/fields';
import { Modal } from '../common/Modal';
import {
  addZone,
  barrelLitres,
  fitCompartments,
  isAutoLayout,
  layoutCompartments,
  mergeCompartment,
  moveBulkhead,
  moveCompartment,
  moveTankBulkhead,
  removeZone,
  scaleZones,
  splitCompartment,
  validateVehicle,
  withKind,
  withStaticsType,
} from './vehicleDraft';
import { LoadCurveChart, VehicleSchematic } from './VehiclePreview';

const CUSTOM = 'custom';
const REGIONS: { value: Region; label: string }[] = [
  { value: 'EU', label: 'EU' },
  { value: 'US', label: 'US' },
  { value: 'custom', label: 'Other' },
];
const KINDS: { value: VehicleKind; label: string }[] = [
  { value: 'van', label: 'Van' },
  { value: 'rigid', label: 'Rigid truck' },
  { value: 'semi', label: 'Semi-trailer' },
  { value: 'container', label: 'Container chassis' },
  { value: 'flatbed', label: 'Flatbed' },
  { value: 'tanker', label: 'Tanker' },
];
const ACCESS: { value: AccessSide; label: string }[] = [
  { value: 'rear', label: 'Rear' },
  { value: 'side', label: 'Side' },
  { value: 'top', label: 'Top' },
];
const TEMPS = (Object.keys(TEMP_LABELS) as TempClass[]).map((t) => ({ value: t, label: TEMP_LABELS[t] }));
const COUNTS = ['1', '2', '3', '4'].map((c) => ({ value: c, label: c === '1' ? 'Single' : c === '2' ? 'Tandem' : c === '3' ? 'Tridem' : '4 axles' }));
const DEFAULT_SLIDER_STEP = 0.1524;

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-card border border-line p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex-1 text-[13px] font-semibold text-ink">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

const grid = 'grid grid-cols-2 gap-3 sm:grid-cols-3';

/** Fuel volume (or volume per hour): litres (metric) or US gallons (imperial). */
function FuelVolumeInput({ litres, onChange, sys, perHour, label, disabled }: { litres: number; onChange: (litres: number) => void; sys: UnitSystem; perHour?: boolean; label: string; disabled?: boolean }) {
  const unit = sys === 'metric' ? 'L' : 'gal';
  return (
    <NumberInput
      value={sys === 'metric' ? litres : litres / L_PER_US_GAL}
      onChange={(n) => onChange(sys === 'metric' ? n : n * L_PER_US_GAL)}
      digits={perHour ? 2 : 0}
      min={0}
      suffix={perHour ? `${unit}/h` : unit}
      aria-label={label}
      disabled={disabled}
    />
  );
}

/** Driving consumption: L/100 km (metric) or US mpg (imperial); the value is always L/100 km. */
function ConsumptionInput({ lPer100km, onChange, sys, label }: { lPer100km: number; onChange: (lPer100km: number) => void; sys: UnitSystem; label: string }) {
  return sys === 'metric' ? (
    <NumberInput value={lPer100km} onChange={onChange} digits={1} min={0.1} aria-label={label} />
  ) : (
    <NumberInput value={lPer100kmToMpg(lPer100km)} onChange={(mpg) => onChange(lPer100kmToMpg(mpg))} digits={1} min={0.1} aria-label={label} />
  );
}

/** Weight-per-length input: kg/m (metric) or lb/ft (imperial). */
function FloorRatingInput({ kgPerM, onChange, sys }: { kgPerM: number; onChange: (kgPerM: number) => void; sys: UnitSystem }) {
  return sys === 'metric' ? (
    <NumberInput value={kgPerM} onChange={onChange} digits={0} min={0} suffix="kg/m" />
  ) : (
    <NumberInput value={kgToLb(kgPerM) * M_PER_FT} onChange={(lbPerFt) => onChange(lbToKg(lbPerFt) / M_PER_FT)} digits={0} min={0} suffix="lb/ft" />
  );
}

interface GroupFieldsProps {
  group: AxleGroup;
  onChange: (group: AxleGroup) => void;
  sys: UnitSystem;
  xLabel?: string;
  xHint?: string;
  /** Hide the position input (steer axle is the tractor datum). */
  fixedX?: boolean;
  showTare?: boolean;
  /** Replaces the position input (e.g. slider hole picker). */
  xInput?: ReactNode;
}

function GroupFields({ group: g, onChange, sys, xLabel = 'Position', xHint, fixedX, showTare = true, xInput }: GroupFieldsProps) {
  const lu = bigLengthUnit(sys);
  const wu = weightUnit(sys);
  const set = (patch: Partial<AxleGroup>) => onChange({ ...g, ...patch });
  return (
    <div className="rounded-lg bg-canvas/70 p-3">
      <div className={grid}>
        <Field label="Label">
          <TextInput value={g.label} onChange={(e) => set({ label: e.target.value })} />
        </Field>
        {!fixedX && (
          <Field label={xLabel} hint={xHint}>
            {xInput ?? <LengthInput metres={g.x} onChange={(x) => set({ x })} unit={lu} min={-30} aria-label={`${g.label} ${xLabel}`} />}
          </Field>
        )}
        <Field label="Axles">
          <Select
            value={String(g.count)}
            onChange={(c) => set({ count: Number(c), spread: Number(c) === 1 ? 0 : g.spread || 1.3 })}
            options={COUNTS}
            aria-label={`${g.label} axle count`}
          />
        </Field>
        {g.count > 1 && (
          <Field label="Spread (first to last axle)">
            <LengthInput metres={g.spread} onChange={(spread) => set({ spread })} unit={lu} aria-label={`${g.label} spread`} />
          </Field>
        )}
        {showTare && (
          <Field label="Tare load" hint="From registration papers or a weighbridge ticket">
            <WeightInput kg={g.tareKg} onChange={(tareKg) => set({ tareKg })} unit={wu} aria-label={`${g.label} tare`} />
          </Field>
        )}
        <Field label="Max load">
          <WeightInput kg={g.maxKg} onChange={(maxKg) => set({ maxKg })} unit={wu} aria-label={`${g.label} max load`} />
        </Field>
        <Field label="Min share of gross" hint="0 = no minimum">
          <NumberInput value={(g.minShare ?? 0) * 100} onChange={(p) => set({ minShare: p > 0 ? p / 100 : undefined })} digits={1} min={0} max={90} suffix="%" aria-label={`${g.label} minimum share`} />
        </Field>
      </div>
    </div>
  );
}

function initialDraft(request: { mode: 'create' | 'edit'; vehicleId?: Id }, vehicles: Vehicle[], presetId: string): Vehicle | null {
  if (request.mode === 'edit') {
    const v = vehicles.find((x) => x.id === request.vehicleId);
    return v ? structuredClone(v) : null;
  }
  return presetId === CUSTOM ? createCustomVehicle() : createVehicle(presetId);
}

/** Custom vehicle editor (create from a preset or edit an existing vehicle) with live side view and load curve. */
export function VehicleEditor({ request }: { request: { mode: 'create' | 'edit'; vehicleId?: Id } }) {
  const sys = useUnitSystem();
  const vehicles = useStore((s) => s.plan.vehicles);
  const closeDialog = useStore((s) => s.closeDialog);
  const updateVehicle = useStore((s) => s.updateVehicle);
  const addVehicle = useStore((s) => s.addVehicle);
  const setActiveVehicle = useStore((s) => s.setActiveVehicle);
  const toast = useStore((s) => s.toast);
  const commit = useStore((s) => s.commit);
  const placements = useStore((s) => s.plan.placements);

  const [presetId, setPresetId] = useState('eu-rigid-18');
  const [draft, setDraft] = useState<Vehicle | null>(() => initialDraft(request, vehicles, presetId));
  /** Compartment positions follow their capacities; off = the user places each bulkhead. */
  const [autoLayout, setAutoLayout] = useState(() => !draft?.tank || isAutoLayout(draft.tank.compartments, draft.cargo.l));
  const close = useCallback(() => closeDialog('vehicleEditor'), [closeDialog]);

  const issues = useMemo(() => (draft ? validateVehicle(draft, sys) : []), [draft, sys]);
  const errors = issues.filter((i) => i.level === 'error');
  const curve = useMemo(() => (draft && !errors.length ? loadDistributionCurve(draft) : null), [draft, errors.length]);
  const peak = curve ? curvePeak(curve) : null;

  if (!draft) {
    return (
      <Modal open title="Vehicle not found" onClose={close} icon={<Truck />}>
        <p className="text-sm text-muted">This vehicle no longer exists in the plan.</p>
      </Modal>
    );
  }

  const v = draft;
  const s = v.statics;
  const lu = bigLengthUnit(sys);
  const wu = weightUnit(sys);
  const set = (patch: Partial<Vehicle>) => setDraft({ ...v, ...patch });
  const setArtic = (patch: Partial<ArticStatics>) => s.type === 'artic' && set({ statics: { ...s, ...patch } });

  const setCargoLength = (l: number) =>
    set({ cargo: { ...v.cargo, l }, zones: scaleZones(v.zones, v.cargo.l, l), ...(v.tank ? { tank: { ...v.tank, compartments: fitCompartments(v.tank.compartments, l, autoLayout) } } : {}) });
  const setTempControlled = (on: boolean) =>
    set(
      on
        ? { tempControlled: true, fuel: v.fuel.reeferLPerHour > 0 ? v.fuel : { ...v.fuel, reeferLPerHour: s.type === 'artic' ? 3.4 : 1.2 } }
        : { tempControlled: false, multiTemp: false, airflowTopGap: 0, zones: [{ id: uid('zone'), temp: 'ambient', fromX: 0, toX: v.cargo.l }], fuel: { ...v.fuel, reeferLPerHour: 0 } },
    );
  const setFuel = (patch: Partial<FuelProfile>) => set({ fuel: { ...v.fuel, ...patch } });
  const consumptionUnit = sys === 'metric' ? 'L/100 km' : 'mpg';
  const toggleAccess = (side: AccessSide) => set({ access: v.access.includes(side) ? v.access.filter((a) => a !== side) : [...v.access, side] });

  const choosePreset = (id: string) => {
    setPresetId(id);
    setDraft(id === CUSTOM ? createCustomVehicle() : createVehicle(id));
    setAutoLayout(true);
  };
  const setKind = (kind: VehicleKind) => {
    if (kind === 'tanker' && !v.tank) setAutoLayout(true);
    setDraft(withKind(v, kind));
  };

  // tank (tankers only)
  const tank = v.kind === 'tanker' ? v.tank : undefined;
  const setTank = (patch: Partial<TankSpec>) => tank && set({ tank: { ...tank, ...patch } });
  const setCompartments = (list: TankCompartment[]) => setTank({ compartments: list });
  const setCapacity = (id: Id, capacityL: number) => {
    const list = (tank?.compartments ?? []).map((c) => (c.id === id ? { ...c, capacityL } : c));
    setCompartments(autoLayout ? layoutCompartments(list, v.cargo.l) : list);
  };
  const setAuto = (on: boolean) => {
    setAutoLayout(on);
    if (on && tank) setCompartments(layoutCompartments(tank.compartments, v.cargo.l));
  };
  const tankLitres = tank?.compartments.reduce((sum, c) => sum + c.capacityL, 0) ?? 0;

  // Fills placed in this vehicle whose compartment the edit removes go back to Unplaced on save.
  const ownPlacements = request.mode === 'edit' ? Object.values(placements).filter((p) => p.vehicleId === v.id) : [];
  const orphanIds = ownPlacements.filter((p) => p.compartmentId !== undefined && !tank?.compartments.some((c) => c.id === p.compartmentId)).map((p) => p.unitId);
  const packagedAboard = tank ? ownPlacements.filter((p) => p.compartmentId === undefined).length : 0;

  const save = () => {
    if (errors.length) return;
    if (request.mode === 'edit') {
      if (orphanIds.length) {
        commit('Edit vehicle', (d) => {
          const i = d.vehicles.findIndex((x) => x.id === v.id);
          if (i >= 0) d.vehicles[i] = structuredClone(v);
          for (const id of orphanIds) delete d.placements[id];
        });
        toast(`Saved ${v.name}; ${orphanIds.length} fill${orphanIds.length === 1 ? '' : 's'} returned to Unplaced`, 'success');
      } else {
        updateVehicle(v);
        toast(`Saved ${v.name}`, 'success');
      }
    } else {
      const id = addVehicle(v);
      setActiveVehicle(id);
      toast(`Added ${v.name}`, 'success');
    }
    close();
  };

  // slider helpers (articulated only)
  const holes = sliderPositions(v);
  const snapToHole = (statics: ArticStatics): ArticStatics => {
    const positions = sliderPositions({ ...v, statics });
    if (!positions.length) return statics;
    const x = positions.reduce((best, p) => (Math.abs(p - statics.trailerAxle.x) < Math.abs(best - statics.trailerAxle.x) ? p : best), positions[0]);
    return { ...statics, trailerAxle: { ...statics.trailerAxle, x } };
  };
  const setSliderPart = (patch: Partial<NonNullable<ArticStatics['slider']>>) => {
    if (s.type !== 'artic' || !s.slider) return;
    set({ statics: snapToHole({ ...s, slider: { ...s.slider, ...patch } }) });
  };

  return (
    <Modal
      open
      width="max-w-5xl"
      icon={<Truck />}
      title={request.mode === 'edit' ? `Edit vehicle · ${v.name}` : 'New vehicle'}
      onClose={close}
      footer={
        <>
          <span className={`mr-auto text-xs ${errors.length ? 'text-bad' : 'text-muted'}`}>
            {errors.length ? `${errors.length} problem${errors.length === 1 ? '' : 's'} to fix before saving` : 'All values are approximate defaults; verify against vehicle documents.'}
          </span>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={errors.length > 0}>
            {request.mode === 'edit' ? 'Save vehicle' : 'Add vehicle'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="General">
            <div className={grid}>
              {request.mode === 'create' && (
                <Field label="Start from" className="col-span-2 sm:col-span-3">
                  <Select
                    value={presetId}
                    onChange={choosePreset}
                    options={[...VEHICLE_PRESETS.map((p) => ({ value: p.id, label: `${p.name} — ${p.summary}` })), { value: CUSTOM, label: 'Blank custom vehicle (rigid)' }]}
                    aria-label="Start from preset"
                  />
                </Field>
              )}
              <Field label="Name" className="col-span-2 sm:col-span-1">
                <TextInput value={v.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Region">
                <Select value={v.region} onChange={(region) => set({ region })} options={REGIONS} aria-label="Region" />
              </Field>
              <Field label="Body">
                <Select value={v.kind} onChange={setKind} options={KINDS} aria-label="Body type" />
              </Field>
              <Field label="Statics" className="col-span-2 sm:col-span-3">
                <SegmentedControl
                  label="Statics type"
                  value={s.type}
                  onChange={(t) => setDraft(withStaticsType(v, t))}
                  options={[
                    { value: 'rigid', label: 'Rigid (two axle groups)' },
                    { value: 'artic', label: 'Tractor + semi-trailer' },
                  ]}
                />
              </Field>
            </div>
          </Section>

          <Section title={tank ? 'Tank barrel and access' : 'Cargo space and doors'}>
            <div className={grid}>
              <Field label={tank ? 'Barrel length' : 'Cargo length'}>
                <LengthInput metres={v.cargo.l} onChange={setCargoLength} unit={lu} aria-label="Cargo length" />
              </Field>
              <Field label={tank ? 'Barrel width' : 'Cargo width'}>
                <LengthInput metres={v.cargo.w} onChange={(w) => set({ cargo: { ...v.cargo, w } })} unit={lu} aria-label="Cargo width" />
              </Field>
              <Field label={tank ? 'Barrel height' : v.walls ? 'Cargo height' : 'Height cap'}>
                <LengthInput metres={v.cargo.h} onChange={(h) => set({ cargo: { ...v.cargo, h } })} unit={lu} aria-label="Cargo height" />
              </Field>
              <Field label="Door width">
                <LengthInput metres={v.door.w} onChange={(w) => set({ door: { ...v.door, w } })} unit={lu} aria-label="Door width" />
              </Field>
              <Field label="Door height">
                <LengthInput metres={v.door.h} onChange={(h) => set({ door: { ...v.door, h } })} unit={lu} aria-label="Door height" />
              </Field>
              <Field label="Deck height" hint="Floor above ground">
                <LengthInput metres={v.deckHeight} onChange={(deckHeight) => set({ deckHeight })} unit={lu} aria-label="Deck height" />
              </Field>
              <Field label="Bay length" hint="Numbered floor bays B.01…">
                <LengthInput metres={v.bayLength} onChange={(bayLength) => set({ bayLength })} unit={lu} aria-label="Bay length" />
              </Field>
              <div className="col-span-2 flex flex-col gap-1 text-xs">
                <span className="font-medium text-ink-soft">Access sides</span>
                <div className="flex flex-wrap gap-1.5">
                  {ACCESS.map((a) => (
                    <button
                      key={a.value}
                      type="button"
                      aria-pressed={v.access.includes(a.value)}
                      onClick={() => toggleAccess(a.value)}
                      className={`h-8 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                        v.access.includes(a.value) ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line bg-card text-muted hover:text-ink'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <Toggle checked={v.walls} onChange={(walls) => set({ walls })} label="Closed body (walls)" hint="Off for flatbeds and open decks" />
            </div>
          </Section>

          {tank && (
            <Section
              title="Tank"
              right={
                <span className="text-[11px] text-muted num">
                  {formatLitres(tankLitres, sys, 0)} in {tank.compartments.length} compartment{tank.compartments.length === 1 ? '' : 's'} · {formatPercent(tankLitres / barrelLitres(v))} of the barrel
                </span>
              }
            >
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted">The cargo space above is the barrel (length × width × height of its elliptical section).</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Toggle checked={tank.baffled} onChange={(baffled) => setTank({ baffled })} label="Surge baffles" hint="Partial fills are safe to drive" />
                  <Toggle checked={tank.foodGrade} onChange={(foodGrade) => setTank({ foodGrade })} label="Food-grade" hint="Stainless; milk, edible oil, drinking water" />
                  <Toggle checked={tank.insulated} onChange={(insulated) => setTank({ insulated })} label="Insulated" hint="Keeps chilled liquids such as milk cold" />
                  <Toggle checked={tank.pressurised} onChange={(pressurised) => setTank({ pressurised })} label="Pressure vessel (LPG)" hint="Liquefied gases; carries only liquids that need it" />
                </div>
                <Toggle checked={autoLayout} onChange={setAuto} label="Position compartments by capacity" hint="Off: set each bulkhead position yourself" />
                <div className="flex items-center gap-2 text-xs font-medium text-ink-soft">
                  <span className="flex-1">Compartments (front to rear)</span>
                  <Button
                    size="sm"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => setCompartments(splitCompartment(tank.compartments, v.cargo.l, autoLayout))}
                    disabled={tank.compartments.length >= 12}
                    title="Adds a bulkhead: the largest compartment is split in two"
                  >
                    Add compartment
                  </Button>
                </div>
                {tank.compartments.map((c, i) => {
                  const last = i === tank.compartments.length - 1;
                  return (
                    <div key={c.id} className="grid grid-cols-[4.5rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-end gap-2">
                      <Field label="Label">
                        <TextInput value={c.label} onChange={(e) => setCompartments(tank.compartments.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))} aria-label={`Compartment ${i + 1} label`} />
                      </Field>
                      <Field label="Capacity (brim)">
                        <LitresInput litres={c.capacityL} onChange={(litres) => setCapacity(c.id, litres)} sys={sys} aria-label={`${c.label} capacity`} />
                      </Field>
                      <Field label="From">
                        <div className="flex h-9 items-center px-1 text-sm text-muted num font-mono">{formatLength(c.fromX, sys, { big: true })}</div>
                      </Field>
                      <Field label={last || autoLayout ? 'To' : 'Bulkhead at'}>
                        {last || autoLayout ? (
                          <div className="flex h-9 items-center px-1 text-sm text-muted num font-mono">{formatLength(c.toX, sys, { big: true })}</div>
                        ) : (
                          <LengthInput metres={c.toX} onChange={(x) => setCompartments(moveTankBulkhead(tank.compartments, i, x))} unit={lu} aria-label={`Bulkhead behind ${c.label}`} />
                        )}
                      </Field>
                      <div className="flex">
                        <IconButton label={`Move ${c.label} forward`} size="sm" disabled={i === 0} onClick={() => setCompartments(moveCompartment(tank.compartments, i, -1, v.cargo.l, autoLayout))}>
                          <ChevronUp className="h-4 w-4" />
                        </IconButton>
                        <IconButton label={`Move ${c.label} back`} size="sm" disabled={last} onClick={() => setCompartments(moveCompartment(tank.compartments, i, 1, v.cargo.l, autoLayout))}>
                          <ChevronDown className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label={`Remove ${c.label} (merge into its neighbour)`}
                          size="sm"
                          disabled={tank.compartments.length <= 1}
                          onClick={() => setCompartments(mergeCompartment(tank.compartments, i, v.cargo.l, autoLayout))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {(orphanIds.length > 0 || packagedAboard > 0) && (
            <div className="flex flex-col gap-1.5 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn" role="status">
              {orphanIds.length > 0 && (
                <p>
                  {orphanIds.length} bulk fill{orphanIds.length === 1 ? ' sits' : 's sit'} in a compartment this edit removes; saving returns {orphanIds.length === 1 ? 'it' : 'them'} to Unplaced.
                </p>
              )}
              {packagedAboard > 0 && (
                <p>
                  {packagedAboard} packaged unit{packagedAboard === 1 ? ' is' : 's are'} on this vehicle; a tanker carries only bulk fills, so {packagedAboard === 1 ? 'it' : 'they'} will be flagged.
                </p>
              )}
            </div>
          )}

          <Section title="Temperature">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <Toggle checked={v.tempControlled} onChange={setTempControlled} label="Temperature controlled" hint="Reefer unit; required for chilled or frozen cargo" />
                <Toggle checked={v.multiTemp} onChange={(multiTemp) => set({ multiTemp })} disabled={!v.tempControlled} label="Movable bulkheads" hint="Optimise sizes the zones" />
              </div>
              {v.tempControlled && (
                <>
                  <div className="max-w-56">
                    <Field label="Airflow gap below ceiling">
                      <LengthInput metres={v.airflowTopGap} onChange={(airflowTopGap) => set({ airflowTopGap })} unit={lu} aria-label="Airflow gap" />
                    </Field>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-ink-soft">
                      <span className="flex-1">Zones (front wall to doors)</span>
                      <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set({ zones: addZone(v.zones, v.cargo.l) })} disabled={v.zones.length >= 4}>
                        Add zone
                      </Button>
                    </div>
                    {v.zones.map((z, i) => (
                      <div key={z.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                        <Field label={`Zone ${i + 1}`}>
                          <Select
                            value={z.temp}
                            onChange={(temp) => set({ zones: v.zones.map((x) => (x.id === z.id ? { ...x, temp } : x)) })}
                            options={TEMPS}
                            aria-label={`Zone ${i + 1} temperature`}
                          />
                        </Field>
                        <Field label="From">
                          <div className="flex h-9 items-center px-1 text-sm text-muted num font-mono">{formatLength(z.fromX, sys, { big: true })}</div>
                        </Field>
                        <Field label={i < v.zones.length - 1 ? 'Bulkhead at' : 'To (doors)'}>
                          {i < v.zones.length - 1 ? (
                            <LengthInput metres={z.toX} onChange={(x) => set({ zones: moveBulkhead(v.zones, i, x, v.cargo.l) })} unit={lu} aria-label={`Bulkhead ${i + 1} position`} />
                          ) : (
                            <div className="flex h-9 items-center px-1 text-sm text-muted num font-mono">{formatLength(z.toX, sys, { big: true })}</div>
                          )}
                        </Field>
                        <IconButton label={`Remove zone ${i + 1}`} size="sm" disabled={v.zones.length <= 1} onClick={() => set({ zones: removeZone(v.zones, i, v.cargo.l) })}>
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Section>

          <Section title="Weights and limits">
            <div className={grid}>
              <Field label={s.type === 'rigid' ? 'Gross vehicle weight (GVW)' : 'Gross combination weight (GCW)'}>
                <WeightInput kg={v.grossLimitKg} onChange={(grossLimitKg) => set({ grossLimitKg })} unit={wu} aria-label="Gross limit" />
              </Field>
              <Field label="Rated payload">
                <WeightInput kg={v.payloadKg} onChange={(payloadKg) => set({ payloadKg })} unit={wu} aria-label="Payload" />
              </Field>
              <Field label="Floor rating" hint="Per running metre / foot">
                <FloorRatingInput kgPerM={v.floorKgPerM} onChange={(floorKgPerM) => set({ floorKgPerM })} sys={sys} />
              </Field>
              <Field label="Max cargo COG height" hint="Above the floor (rollover)">
                <LengthInput metres={v.maxCogHeight} onChange={(maxCogHeight) => set({ maxCogHeight })} unit={lu} aria-label="Max COG height" />
              </Field>
              <Field label="Lateral imbalance limit">
                <NumberInput value={v.lateralMaxImbalance * 100} onChange={(p) => set({ lateralMaxImbalance: p / 100 })} digits={1} min={0} max={100} suffix="%" aria-label="Lateral imbalance limit" />
              </Field>
              <div className="flex items-end pb-1">
                <Toggle checked={v.bridgeFormula} onChange={(bridgeFormula) => set({ bridgeFormula })} label="US Bridge Formula" />
              </div>
            </div>
          </Section>

          <Section title="Fuel" right={<span className="text-[11px] text-muted">Consumption is linear in the cargo weight between empty and full</span>}>
            <div className={grid}>
              <Field label={`Empty (${consumptionUnit})`}>
                <ConsumptionInput lPer100km={v.fuel.emptyLPer100km} onChange={(emptyLPer100km) => setFuel({ emptyLPer100km })} sys={sys} label="Consumption empty" />
              </Field>
              <Field label={`At full payload (${consumptionUnit})`}>
                <ConsumptionInput lPer100km={v.fuel.fullLPer100km} onChange={(fullLPer100km) => setFuel({ fullLPer100km })} sys={sys} label="Consumption at full payload" />
              </Field>
              <Field label="Fuel tank">
                <FuelVolumeInput litres={v.fuel.tankL} onChange={(tankL) => setFuel({ tankL })} sys={sys} label="Fuel tank capacity" />
              </Field>
              <Field label="Engine idling" hint="While stopped at a delivery">
                <FuelVolumeInput litres={v.fuel.idleLPerHour} onChange={(idleLPerHour) => setFuel({ idleLPerHour })} sys={sys} perHour label="Idle fuel use" />
              </Field>
              <Field label="Reefer unit" hint={v.tempControlled ? 'While chilled or frozen cargo is aboard' : 'Turn on temperature control first'}>
                <FuelVolumeInput litres={v.fuel.reeferLPerHour} onChange={(reeferLPerHour) => setFuel({ reeferLPerHour })} sys={sys} perHour label="Reefer fuel use" disabled={!v.tempControlled} />
              </Field>
            </div>
          </Section>

          {s.type === 'rigid' ? (
            <Section title="Axles (rigid)" right={<span className="text-[11px] text-muted">Positions from the cargo front wall; negative = ahead of it</span>}>
              <div className="flex flex-col gap-3">
                <GroupFields group={s.front} onChange={(front) => set({ statics: { ...s, front } })} sys={sys} />
                <GroupFields group={s.rear} onChange={(rear) => set({ statics: { ...s, rear } })} sys={sys} />
              </div>
            </Section>
          ) : (
            <>
              <Section title="Trailer" right={<span className="text-[11px] text-muted">Positions from the cargo front wall</span>}>
                <div className="flex flex-col gap-3">
                  <div className={grid}>
                    <Field label="Kingpin position">
                      <LengthInput metres={s.kingpinX} onChange={(kingpinX) => setArtic({ kingpinX })} unit={lu} aria-label="Kingpin position" />
                    </Field>
                    <Field label="Trailer tare">
                      <WeightInput kg={s.trailerTareKg} onChange={(trailerTareKg) => setArtic({ trailerTareKg })} unit={wu} aria-label="Trailer tare" />
                    </Field>
                    <Field label="Trailer tare COG">
                      <LengthInput metres={s.trailerTareX} onChange={(trailerTareX) => setArtic({ trailerTareX })} unit={lu} aria-label="Trailer tare COG" />
                    </Field>
                  </div>
                  <GroupFields
                    group={s.trailerAxle}
                    onChange={(trailerAxle) => set({ statics: snapToHole({ ...s, trailerAxle }) })}
                    sys={sys}
                    showTare={false}
                    xLabel={s.slider ? 'Slider hole' : 'Position'}
                    xInput={
                      s.slider ? (
                        <Select
                          value={String(Math.max(0, holes.findIndex((x) => Math.abs(x - s.trailerAxle.x) < 0.001)))}
                          onChange={(i) => setArtic({ trailerAxle: { ...s.trailerAxle, x: holes[Number(i)] } })}
                          options={holes.map((x, i) => ({ value: String(i), label: `Hole ${i + 1} · ${formatLength(x, sys, { big: true })}` }))}
                          aria-label="Trailer axle slider hole"
                        />
                      ) : undefined
                    }
                  />
                  <Toggle
                    checked={!!s.slider}
                    onChange={(on) => {
                      if (on) setDraft({ ...v, statics: { ...s, slider: { minX: s.trailerAxle.x - 12 * DEFAULT_SLIDER_STEP, step: DEFAULT_SLIDER_STEP, holes: 27 } } });
                      else {
                        const rest = { ...s };
                        delete rest.slider;
                        setDraft({ ...v, statics: rest });
                      }
                    }}
                    label="Sliding tandem"
                    hint="Trailer axle group moves over a row of holes"
                  />
                  {s.slider && (
                    <div className={grid}>
                      <Field label="Foremost hole">
                        <LengthInput metres={s.slider.minX} onChange={(minX) => setSliderPart({ minX })} unit={lu} aria-label="Foremost slider hole" />
                      </Field>
                      <Field label="Hole spacing">
                        <LengthInput metres={s.slider.step} onChange={(step) => setSliderPart({ step })} unit={sys === 'metric' ? 'cm' : 'in'} aria-label="Slider hole spacing" />
                      </Field>
                      <Field label="Number of holes">
                        <NumberInput value={s.slider.holes} onChange={(n) => setSliderPart({ holes: Math.round(n) })} digits={0} min={2} max={60} aria-label="Number of slider holes" />
                      </Field>
                    </div>
                  )}
                </div>
              </Section>
              <Section title="Tractor" right={<span className="text-[11px] text-muted">Positions from the steer axle</span>}>
                <div className="flex flex-col gap-3">
                  <GroupFields group={s.steer} onChange={(steer) => setArtic({ steer: { ...steer, x: 0 } })} sys={sys} fixedX />
                  <GroupFields group={s.drive} onChange={(drive) => setArtic({ drive })} sys={sys} xLabel="Steer to drive" />
                  <div className="max-w-56">
                    <Field label="Fifth wheel position" hint="Behind the steer axle">
                      <LengthInput metres={s.fifthWheelX} onChange={(fifthWheelX) => setArtic({ fifthWheelX })} unit={lu} aria-label="Fifth wheel position" />
                    </Field>
                  </div>
                </div>
              </Section>
            </>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-card border border-line p-3">
            <h3 className="mb-2 text-[13px] font-semibold">Side view</h3>
            <VehicleSchematic vehicle={v} sys={sys} peakX={peak?.x} />
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-muted">Tare</dt>
                <dd className="num font-mono">{formatMass(vehicleTareKg(v), sys)}</dd>
              </div>
              <div>
                <dt className="text-muted">Gross limit</dt>
                <dd className="num font-mono">{formatMass(v.grossLimitKg, sys)}</dd>
              </div>
              <div>
                <dt className="text-muted">Payload</dt>
                <dd className="num font-mono">{formatMass(v.payloadKg, sys)}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-card border border-line p-3">
            <h3 className="mb-2 text-[13px] font-semibold">Load distribution</h3>
            {curve && peak ? (
              <LoadCurveChart vehicle={v} curve={curve} peak={peak} sys={sys} />
            ) : (
              <p className="text-xs text-muted">Fix the problems below to see the maximum legal payload along the floor.</p>
            )}
          </div>
          {issues.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-live="polite">
              {issues.map((i, k) => (
                <li key={k} className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs ${i.level === 'error' ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn'}`}>
                  {i.level === 'error' ? <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> : <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />}
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </Modal>
  );
}
