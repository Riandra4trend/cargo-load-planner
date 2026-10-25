import { FilePlus2, FileSpreadsheet, Forklift, PackagePlus, Sparkles, Square, Truck, Warehouse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createSeedPlan, createTankerSeedPlan, createTipperSeedPlan } from '../../data/seed';
import type { Plan } from '../../domain/types';
import { isBulk } from '../../domain/geometry';
import { useActiveVehicleEval, useEvaluation } from '../../state/hooks';
import { useStore } from '../../state/store';
import { CargoPalette } from '../data/CargoPalette';
import { Button } from '../common/Button';
import { isCargoDrag } from '../common/dragTypes';
import { useLoadSimulation } from './navigation';

/** True while cargo is dragged (a palette card or a table row), so overlays let the drop reach the 3D view. */
function useCargoDragActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const start = (e: DragEvent) => setActive(isCargoDrag(e.dataTransfer));
    const stop = () => setActive(false);
    window.addEventListener('dragstart', start);
    window.addEventListener('dragend', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragstart', start);
      window.removeEventListener('dragend', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);
  return active;
}

const STEPS = ['Pick a vehicle', 'Add cargo', 'Optimise'];
const SAMPLES: { label: string; create: () => Plan }[] = [
  { label: 'mixed freight', create: createSeedPlan },
  { label: 'fuel tanker', create: createTankerSeedPlan },
  { label: 'dump trucks', create: createTipperSeedPlan },
];

/** Empty-truck card with entry points and the three-step onboarding hint. Only the card takes pointer events, and not while cargo is dragged. */
function EmptyTruckCard({ shifted }: { shifted: boolean }) {
  const ve = useActiveVehicleEval();
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const openDialog = useStore((s) => s.openDialog);
  const replacePlan = useStore((s) => s.replacePlan);
  const hasVehicles = useStore((s) => s.plan.vehicles.length > 0);
  const dragging = useCargoDragActive();
  if (ve.unitIds.length > 0 || !hasVehicles) return null;
  return (
    <div className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4 pt-24 ${shifted ? 'pl-[356px]' : ''}`}>
      <div
        role="region"
        aria-label="Empty vehicle"
        className={`w-full max-w-sm rounded-card border border-line bg-card/95 p-4 shadow-card backdrop-blur-sm transition-opacity ${dragging ? 'pointer-events-none opacity-30' : 'pointer-events-auto'}`}
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 rounded-lg bg-accent-soft p-1.5 text-accent-strong">
            <Truck className="h-4 w-4" aria-hidden />
          </span>
          <p className="text-sm text-ink">
            <span className="font-semibold">{ve.vehicle.name}</span> is empty. Add cargo to load it.
          </p>
        </div>
        <ol className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-soft" aria-label="Getting started">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-muted" aria-hidden>·</span>}
              <span className={`num inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${i === 1 ? 'bg-accent text-white' : 'bg-black/[0.07] text-ink-soft'}`}>{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" icon={<PackagePlus className="h-3.5 w-3.5" />} onClick={() => setPaletteOpen(true)}>
            Add cargo
          </Button>
          <Button size="sm" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => openDialog('itemEditor', { mode: 'create' })}>
            New item
          </Button>
          <Button size="sm" icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => openDialog('import', true)}>
            Import CSV
          </Button>
        </div>
        <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted">
          <Sparkles className="h-3 w-3" aria-hidden />
          Or try a sample (also in the File menu):
          {SAMPLES.map((sample, i) => (
            <span key={sample.label} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>·</span>}
              <button
                type="button"
                className="font-medium text-accent-strong underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => replacePlan(sample.create(), { keepHistory: true })}
              >
                {sample.label}
              </button>
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

/** Toggles the load-at-dock simulation: starts it for the active vehicle, or stops it while it runs. */
function useLoadToggle(): { running: boolean; toggle: () => void } {
  const running = useStore((s) => s.ui.animation.mode === 'load');
  const setAnimation = useStore((s) => s.setAnimation);
  const start = useLoadSimulation();
  return { running, toggle: () => (running ? setAnimation({ mode: 'idle', playing: false, step: 0 }) : start()) };
}

/** Top-centre chip while packaged units wait in the warehouse (unplaced); hidden during simulations and optimiser runs. */
function WarehouseChip({ shifted }: { shifted: boolean }) {
  const evaluation = useEvaluation();
  const busy = useStore((s) => s.ui.animation.mode !== 'idle' || s.ui.optimise.running || !!s.ui.optimise.diff);
  const startOptimise = useStore((s) => s.startOptimise);
  const load = useLoadToggle();
  const waiting = evaluation.unplaced.filter((u) => !isBulk(u.spec)).length;
  if (waiting === 0 || busy) return null;
  return (
    <div className={`pointer-events-none absolute inset-x-0 top-12 z-10 flex justify-center px-3 ${shifted ? 'pl-[352px]' : ''}`}>
      <div role="status" className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-card/95 py-1 pl-3 pr-1 text-xs shadow-card backdrop-blur-sm">
        <Warehouse className="h-3.5 w-3.5 text-accent-strong" aria-hidden />
        <span className="font-medium text-ink">
          <span className="num">{waiting}</span> unit{waiting === 1 ? '' : 's'} waiting in the warehouse
        </span>
        <Button size="sm" variant="primary" className="!h-7 !rounded-full" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => startOptimise()} title="Pack the waiting units into the vehicles">
          Optimise
        </Button>
        <Button size="sm" className="!h-7 !rounded-full" icon={<Forklift className="h-3.5 w-3.5" />} onClick={load.toggle} title="Animate the forklift loading sequence at the dock">
          Load at dock
        </Button>
      </div>
    </div>
  );
}

/**
 * Overlays inside the viewport container: the cargo palette drawer (left, ~340 px, its own scroll), the
 * bottom-right [Load at dock] [Add cargo] buttons, the warehouse chip (units waiting) and the empty-truck card.
 * Everything outside these elements lets pointer events through so orbiting, dragging and drops keep working.
 */
export function ViewportOverlays() {
  const paletteOpen = useStore((s) => s.ui.paletteOpen);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const load = useLoadToggle();
  return (
    <>
      <EmptyTruckCard shifted={paletteOpen} />
      <WarehouseChip shifted={paletteOpen} />
      {paletteOpen && (
        <aside aria-label="Add cargo" data-cargo-palette className="absolute inset-y-0 left-0 z-20 flex w-[340px] max-w-[85%] flex-col overflow-hidden border-r border-line bg-card shadow-xl">
          <CargoPalette onClose={() => setPaletteOpen(false)} />
        </aside>
      )}
      <div className="absolute bottom-3 right-3 z-10 flex gap-2">
        <Button
          className="shadow-lg"
          aria-pressed={load.running}
          icon={load.running ? <Square className="h-3.5 w-3.5" /> : <Forklift className="h-4 w-4" />}
          onClick={load.toggle}
          title={load.running ? 'Stop the loading animation' : 'Animate the forklift loading sequence at the dock'}
        >
          {load.running ? 'Stop loading' : 'Load at dock'}
        </Button>
        {!paletteOpen && (
          <Button variant="primary" icon={<PackagePlus className="h-4 w-4" />} className="shadow-lg" onClick={() => setPaletteOpen(true)} title="Add cargo to the truck (A)">
            Add cargo
          </Button>
        )}
      </div>
    </>
  );
}
