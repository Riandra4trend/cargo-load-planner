import { ArrowRight, ChevronLeft, ChevronRight, Forklift, Pause, Play, Printer, RotateCcw, Truck, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Plan } from '../../domain/types';
import { useActiveVehicleEval, useDisplayPlan, useEvaluation, useUnitSystem } from '../../state/hooks';
import { useStore, type AnimationState } from '../../state/store';
import { Button, IconButton } from '../common/Button';
import { ColorDot } from '../common/Chip';
import { SegmentedControl } from '../common/fields';
import { stopColorsBySeq } from './shellFormat';
import { dischargeInstruction, fillInstruction } from './bulk';
import { useLoadingSequence } from './useShownState';

const SPEEDS = ['0.5', '1', '2', '4'] as const;

function Controls({ anim, max, onPrint }: { anim: AnimationState; max: number; onPrint?: () => void }) {
  const setAnimation = useStore((s) => s.setAnimation);
  const done = anim.step >= max;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <IconButton label="Step back" size="sm" variant="secondary" disabled={anim.step <= 0} onClick={() => setAnimation({ step: anim.step - 1, playing: false })}>
        <ChevronLeft className="h-4 w-4" />
      </IconButton>
      <IconButton
        label={anim.playing ? 'Pause (Space)' : done ? 'Replay (Space)' : 'Play (Space)'}
        size="sm"
        variant="primary"
        onClick={() => setAnimation(anim.playing ? { playing: false } : { playing: true, step: done ? 0 : anim.step })}
      >
        {anim.playing ? <Pause className="h-4 w-4" /> : done ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </IconButton>
      <IconButton label="Step forward" size="sm" variant="secondary" disabled={done} onClick={() => setAnimation({ step: anim.step + 1, playing: false })}>
        <ChevronRight className="h-4 w-4" />
      </IconButton>
      <SegmentedControl
        size="sm"
        label="Playback speed"
        value={(SPEEDS.find((s) => Number(s) === anim.speed) ?? '1') as (typeof SPEEDS)[number]}
        onChange={(s) => setAnimation({ speed: Number(s) })}
        options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
      />
      {onPrint && <IconButton label="Print instructions" size="sm" onClick={onPrint}><Printer className="h-4 w-4" /></IconButton>}
    </div>
  );
}

function stopLabel(plan: Plan, seq: number): string {
  const stop = plan.stops.find((s) => s.sequence === seq);
  return stop ? `Stop ${seq} · ${stop.name}` : `Stop ${seq}`;
}

function LoadSimulation({ anim }: { anim: AnimationState }) {
  const plan = useDisplayPlan();
  const evaluation = useEvaluation();
  const sys = useUnitSystem();
  const openDialog = useStore((s) => s.openDialog);
  const setAnimation = useStore((s) => s.setAnimation);
  const steps = useLoadingSequence(anim.vehicleId ?? '');
  const vehicle = plan.vehicles.find((v) => v.id === anim.vehicleId);
  const colors = stopColorsBySeq(plan);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
  }, [anim.step]);
  const loaded = Math.min(anim.step, steps.length);
  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="num font-mono text-ink">
          {loaded} / {steps.length}
        </span>
        <span className="text-muted">{vehicle?.bulk ? 'fills loaded' : 'units loaded'}</span>
        <div className="h-1.5 flex-1 rounded-full bg-black/[0.06]">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${steps.length ? (loaded / steps.length) * 100 : 0}%` }} />
        </div>
      </div>
      <Controls anim={anim} max={steps.length} onPrint={() => openDialog('report', true)} />
      {steps.length === 0 ? (
        <p className="mt-2 text-xs text-muted">Nothing is placed on this vehicle yet.</p>
      ) : (
        <ol ref={listRef} className="mt-2 max-h-56 space-y-0.5 overflow-y-auto pr-1" aria-label="Loading instructions">
          {steps.map((s, i) => {
            const current = i === anim.step;
            const isDone = i < anim.step;
            return (
              <li key={s.unitId} aria-current={current ? 'step' : undefined}>
                <button
                  type="button"
                  onClick={() => setAnimation({ step: i, playing: false })}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                    current ? 'bg-accent-soft text-ink ring-1 ring-accent/50' : isDone ? 'text-muted hover:bg-black/[0.03]' : 'text-ink-soft hover:bg-black/[0.03]'
                  }`}
                  title={stopLabel(plan, s.stopSeq)}
                >
                  <span className="num w-12 shrink-0 font-mono font-semibold">Step {i + 1}</span>
                  <ColorDot color={colors.get(s.stopSeq) ?? '#999'} className="mt-1" size={8} />
                  <span className="min-w-0 flex-1">
                    {s.compartmentId && vehicle && evaluation.unitById.get(s.unitId) ? (
                      <span className={isDone ? 'line-through decoration-muted/50' : ''}>{fillInstruction(vehicle, evaluation.unitById.get(s.unitId)!, s.compartmentId, sys)}</span>
                    ) : (
                      <>
                        <span className={isDone ? 'line-through decoration-muted/50' : ''}>{s.name}</span>
                        <ArrowRight className="mx-1 inline h-3 w-3 text-muted" aria-label="to" />
                        <span className="text-muted">{s.position}</span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function UnloadSimulation({ anim }: { anim: AnimationState }) {
  const plan = useDisplayPlan();
  const evaluation = useEvaluation();
  const sys = useUnitSystem();
  const ve = useActiveVehicleEval();
  const setAnimation = useStore((s) => s.setAnimation);
  const stages = ve.stages;
  const stageIndex = Math.max(0, Math.min(anim.step, stages.length - 1));
  const st = stages[stageIndex];
  const prev = stages[stageIndex - 1];
  const leaving = prev ? prev.unitIds.length - st.unitIds.length : 0;
  const colors = stopColorsBySeq(plan);
  const bulkVehicle = !!ve.vehicle.bulk;
  const tipper = ve.vehicle.bulk?.kind === 'tipper';
  const noun = bulkVehicle ? 'fill' : 'unit';
  const aboardNow = new Set(st.unitIds);
  const discharged = bulkVehicle && prev ? prev.unitIds.filter((id) => !aboardNow.has(id)).map((id) => evaluation.unitById.get(id)).filter((u) => u !== undefined) : [];
  return (
    <>
      <div role="tablist" aria-label="Unloading stage" className="mb-2 flex flex-wrap gap-1">
        {stages.map((s, i) => (
          <button
            key={s.stage}
            type="button"
            role="tab"
            aria-selected={i === stageIndex}
            onClick={() => setAnimation({ step: i, playing: false })}
            className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
              i === stageIndex ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-soft hover:bg-black/[0.03]'
            }`}
          >
            {s.stage > 0 && <ColorDot color={colors.get(s.stage) ?? '#999'} size={7} />}
            {s.label}
          </button>
        ))}
      </div>
      <Controls anim={{ ...anim, step: stageIndex }} max={stages.length - 1} />
      <p className="mt-2 text-xs text-ink-soft">
        {st.stage === 0 ? (
          <>
            Fully loaded at departure: {st.unitIds.length} {noun}s aboard.
          </>
        ) : (
          <>
            {stopLabel(plan, st.stage)}: {leaving} {noun}
            {leaving === 1 ? '' : 's'} {tipper ? 'tipped' : bulkVehicle ? 'discharged' : 'unloaded'}, {st.unitIds.length} still aboard.
          </>
        )}{' '}
        The panels below show this stage.
      </p>
      {discharged.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs">
          {discharged.map((u) => (
            <li key={u.id} className="flex items-center gap-1.5 text-ink">
              <ColorDot color={colors.get(u.stopSeq) ?? '#999'} size={7} />
              {dischargeInstruction(plan, u, sys)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Load-at-dock / unload simulation controls; shown on top of the right panel while a simulation runs. */
export function SimulationPanel() {
  const anim = useStore((s) => s.ui.animation);
  const setAnimation = useStore((s) => s.setAnimation);
  if (anim.mode === 'idle') return null;
  const load = anim.mode === 'load';
  return (
    <section aria-label={load ? 'Load simulation' : 'Unload simulation'} className="border-b border-line bg-canvas/50 px-4 pb-3 pt-3 md:col-span-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-accent-strong">{load ? <Forklift className="h-4 w-4" /> : <Truck className="h-4 w-4" />}</span>
        <h3 className="flex-1 text-[13px] font-semibold">{load ? 'Load at dock' : 'Unload by stop'}</h3>
        <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => setAnimation({ mode: 'idle', playing: false, step: 0 })}>
          Exit
        </Button>
      </div>
      {load ? <LoadSimulation anim={anim} /> : <UnloadSimulation anim={anim} />}
    </section>
  );
}
