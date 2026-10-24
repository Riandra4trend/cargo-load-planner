import { Lightbulb, MoreHorizontal, Pencil, Plus, Repeat, Trash2, Truck, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import { createVehicle, VEHICLE_PRESETS } from '../../domain/presets';
import { formatDims, formatMass } from '../../domain/units';
import { proposeVehicles } from '../../packing';
import { useEvaluation, useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Button } from '../common/Button';
import { Menu, type MenuEntry } from './Menu';
import { HEALTH_DOT, HEALTH_LABEL, vehicleHealth } from './shellFormat';
import { formatCargoLitres, tankCapacityL } from './tanker';

const presetName = (id: string): string => VEHICLE_PRESETS.find((p) => p.id === id)?.name ?? id;

/** Replaces the plan's vehicles with a proposal (keeping matching vehicles and their placements), then optimises. */
function applyProposal(presetIds: string[]): void {
  const { plan, commit, setActiveVehicle, startOptimise } = useStore.getState();
  const kept = new Set<string>();
  const vehicles = presetIds.map((presetId, i) => {
    const existing = plan.vehicles[i];
    if (existing && existing.presetId === presetId) {
      kept.add(existing.id);
      return structuredClone(existing);
    }
    const v = createVehicle(presetId);
    v.name = `Truck ${i + 1} · ${v.name}`;
    return v;
  });
  commit('Apply suggested vehicles', (d) => {
    d.vehicles = vehicles;
    for (const [unitId, p] of Object.entries(d.placements)) if (!kept.has(p.vehicleId)) delete d.placements[unitId];
  });
  setActiveVehicle(vehicles[0].id);
  startOptimise();
}

function VehicleActions({ vehicleId, canRemove }: { vehicleId: string; canRemove: boolean }) {
  const s = useStore.getState;
  const entries: MenuEntry[] = [
    { label: 'Edit…', icon: <Pencil />, onSelect: () => s().openDialog('vehicleEditor', { mode: 'edit', vehicleId }) },
    { kind: 'separator' },
    { kind: 'heading', label: 'Switch preset (re-packs)' },
    ...VEHICLE_PRESETS.map<MenuEntry>((p) => ({
      label: p.name,
      icon: <Repeat />,
      hint: p.region,
      onSelect: () => {
        s().switchVehiclePreset(vehicleId, p.id);
        s().startOptimise({ vehicleIds: [vehicleId] });
      },
    })),
    { kind: 'separator' },
    { label: 'Remove', icon: <Trash2 />, danger: true, disabled: !canRemove, onSelect: () => s().removeVehicle(vehicleId) },
  ];
  return (
    <Menu
      label="Vehicle actions"
      align="right"
      width="w-64"
      entries={entries}
      triggerClassName="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-black/5 hover:text-ink"
      trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
    />
  );
}

/** Vehicles of the plan with dimensions, payload and health; add/switch/remove/suggest. */
export function VehicleList() {
  const sys = useUnitSystem();
  const evaluation = useEvaluation();
  const activeId = useStore((s) => s.ui.activeVehicleId);
  const setActiveVehicle = useStore((s) => s.setActiveVehicle);
  const animation = useStore((s) => s.ui.animation);
  const setAnimation = useStore((s) => s.setAnimation);
  const [proposal, setProposal] = useState<string[] | null>(null);
  const vehicles = evaluation.plan.vehicles;

  const activate = (id: string) => {
    setActiveVehicle(id);
    if (animation.mode !== 'idle' && animation.vehicleId !== id) setAnimation({ vehicleId: id, step: 0, playing: false });
  };

  const addEntries: MenuEntry[] = [
    { kind: 'heading', label: 'Presets' },
    ...VEHICLE_PRESETS.map<MenuEntry>((p) => ({
      label: p.name,
      icon: <Truck />,
      hint: p.region,
      onSelect: () => activate(useStore.getState().addVehicle(p.id)),
    })),
    { kind: 'separator' },
    { label: 'Custom vehicle…', icon: <Wrench />, onSelect: () => useStore.getState().openDialog('vehicleEditor', { mode: 'create' }) },
  ];

  return (
    <div>
      <ul className="space-y-1">
        {vehicles.map((v) => {
          const ve = evaluation.byVehicle[v.id];
          const health = vehicleHealth(ve);
          const active = v.id === activeId;
          return (
            <li key={v.id} className={`group flex items-start gap-1 rounded-xl border p-2 transition-colors ${active ? 'border-accent/60 bg-accent-soft/50' : 'border-transparent hover:bg-black/[0.03]'}`}>
              <button type="button" aria-pressed={active} onClick={() => activate(v.id)} className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-accent">
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT[health]}`} title={HEALTH_LABEL[health]} aria-label={HEALTH_LABEL[health]} role="img" />
                  <span className="truncate text-[13px] font-semibold text-ink">{v.name}</span>
                </span>
                {v.tank ? (
                  <>
                    <span className="num mt-0.5 block truncate pl-3.5 text-[11px] text-ink-soft">
                      {formatCargoLitres(tankCapacityL(v), sys)} · {v.tank.compartments.length} compartment{v.tank.compartments.length === 1 ? '' : 's'}
                    </span>
                    <span className="num block truncate pl-3.5 text-[10.5px] text-muted/80">{formatDims(v.cargo, sys, { big: true })} barrel</span>
                  </>
                ) : (
                  <span className="num mt-0.5 block truncate pl-3.5 text-[11px] text-muted">{formatDims(v.cargo, sys, { big: true })}</span>
                )}
                <span className="num block truncate pl-3.5 text-[11px] text-muted">
                  {formatMass(ve.axle.cargoKg, sys)} of {formatMass(v.payloadKg, sys)} payload
                </span>
              </button>
              <VehicleActions vehicleId={v.id} canRemove={vehicles.length > 1} />
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1">
        <Menu
          label="Add vehicle"
          entries={addEntries}
          width="w-64"
          triggerClassName="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-xs font-medium text-ink hover:bg-canvas"
          trigger={
            <>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add vehicle
            </>
          }
        />
        <Button size="sm" variant="ghost" icon={<Lightbulb className="h-3.5 w-3.5" />} onClick={() => setProposal(proposeVehicles(useStore.getState().plan))} title="Propose the fewest vehicles that carry everything">
          Suggest
        </Button>
      </div>
      {proposal && (
        <div role="region" aria-label="Suggested vehicles" className="mt-2 rounded-xl border border-info/30 bg-info-soft/60 p-2.5 text-xs">
          <div className="mb-1 flex items-center gap-1">
            <p className="flex-1 font-semibold text-ink">
              {proposal.length === 0 ? 'No vehicle fits' : proposal.length === 1 ? '1 vehicle carries everything' : `${proposal.length} vehicles carry everything`}
            </p>
            <button type="button" aria-label="Dismiss suggestion" className="rounded p-0.5 text-muted hover:text-ink" onClick={() => setProposal(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {proposal.length === 0 ? (
            <p className="text-ink-soft">At least one unit fits no preset vehicle; check its dimensions and weight.</p>
          ) : (
            <>
              <ol className="mb-2 list-decimal space-y-0.5 pl-4 text-ink-soft">
                {proposal.map((id, i) => (
                  <li key={`${id}-${i}`}>{presetName(id)}</li>
                ))}
              </ol>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  applyProposal(proposal);
                  setProposal(null);
                }}
              >
                Apply and optimise
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
