import { Crosshair, Minus, Plus, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { sliderPositions } from '../../domain/presets';
import { formatLength, formatPercent, formatWeight } from '../../domain/units';
import type { AxleLoad, AxleState, UnitSystem, Vehicle } from '../../domain/types';
import { axleContributions, bestSliderPosition, type MassPoint } from '../../physics';
import type { VehicleEval } from '../../state/evaluate';
import { useEvaluation, useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Button, IconButton } from '../common/Button';
import { AxleStatusChip } from '../common/Chip';
import { Section } from './Section';
import { STATUS_BAR, STATUS_TEXT, weightPair } from './shellFormat';
import type { ShownState } from './useShownState';

function AxleBar({
  load,
  groupIndex,
  vehicle,
  points,
  scale,
  sys,
}: {
  load: AxleLoad;
  groupIndex: number;
  vehicle: Vehicle;
  points: readonly MassPoint[];
  scale: number;
  sys: UnitSystem;
}) {
  const [open, setOpen] = useState(false);
  const setHoverAxle = useStore((s) => s.setHoverAxle);
  const evaluation = useEvaluation();
  const contributors = useMemo(() => (open ? axleContributions(vehicle, points, groupIndex, 5) : []), [open, vehicle, points, groupIndex]);
  const fill = Math.min(1, load.kg / (load.maxKg * scale));
  const show = () => {
    setOpen(true);
    setHoverAxle({ vehicleId: vehicle.id, axleId: load.id });
  };
  const hide = () => {
    setOpen(false);
    setHoverAxle(null);
  };
  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      <div
        tabIndex={0}
        aria-label={`${load.label}: ${formatWeight(load.kg, sys)} of ${formatWeight(load.maxKg, sys)}, ${formatPercent(load.ratio)}`}
        className="rounded-lg px-1 py-1 -mx-1 outline-none transition-colors hover:bg-black/[0.03] focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <div className="mb-1 flex items-baseline gap-2 text-xs">
          <span className="flex-1 truncate font-medium text-ink-soft">{load.label}</span>
          <span className={`num font-mono text-[11.5px] ${load.status === 'legal' ? 'text-ink' : STATUS_TEXT[load.status]}`}>
            {weightPair(load.kg, load.maxKg, sys)}
          </span>
        </div>
        <div className="relative h-2.5 rounded-full bg-black/[0.06]">
          <div className={`h-full rounded-full transition-[width] duration-150 ${STATUS_BAR[load.status]}`} style={{ width: `${fill * 100}%` }} />
          <span className="absolute -top-1 h-[18px] w-0.5 rounded bg-ink" style={{ left: `${(1 / scale) * 100}%` }} title={`Limit ${formatWeight(load.maxKg, sys)}`} aria-hidden />
          {load.minKg > 0 && (
            <span
              className="absolute -top-0.5 h-[14px] w-0.5 rounded bg-info"
              style={{ left: `${Math.min(1, load.minKg / (load.maxKg * scale)) * 100}%` }}
              title={`Minimum ${formatWeight(load.minKg, sys)}`}
              aria-hidden
            />
          )}
        </div>
        {load.status === 'under' && <p className="mt-1 text-[11px] text-bad">Below the minimum of {formatWeight(load.minKg, sys)}</p>}
      </div>
      {open && (
        <div role="tooltip" className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-line bg-card p-3 text-xs shadow-lg">
          <p className="mb-1.5 font-semibold text-ink">Top contributors to the {load.label.toLowerCase()}</p>
          {contributors.length === 0 ? (
            <p className="text-muted">No cargo aboard; tare only.</p>
          ) : (
            <ol className="space-y-1">
              {contributors.map((c) => {
                const unit = evaluation.unitById.get(c.id);
                return (
                  <li key={c.id} className="flex items-baseline gap-2">
                    <span className="flex-1 truncate text-ink-soft">
                      {unit ? `${unit.spec.name} #${unit.index + 1}` : c.id}
                    </span>
                    <span className="num font-mono text-ink">{formatWeight(c.kg, sys)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function SliderControl({ ve }: { ve: VehicleEval }) {
  const sys = useUnitSystem();
  const plan = useEvaluation().plan;
  const setSlider = useStore((s) => s.setSlider);
  const v = ve.vehicle;
  const holes = sliderPositions(v);
  const best = useMemo(() => {
    const sets = ve.stages.map((st) => {
      const aboard = new Set(st.unitIds);
      return ve.points.filter((p) => aboard.has(p.id));
    });
    return bestSliderPosition(v, sets, plan.settings.nearLimit);
  }, [ve, v, plan.settings.nearLimit]);
  if (v.statics.type !== 'artic' || holes.length === 0) return null;
  const x = v.statics.trailerAxle.x;
  const current = holes.reduce((bi, h, i) => (Math.abs(h - x) < Math.abs(holes[bi] - x) ? i : bi), 0);
  const kingpinToAxle = x - v.statics.kingpinX;
  const atBest = best !== null && best.hole === current;
  return (
    <div className="mt-3 rounded-xl border border-line bg-canvas/60 p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs font-semibold text-ink">Sliding tandem</span>
        <IconButton label="Slide tandem one hole forward" size="sm" variant="secondary" disabled={current === 0} onClick={() => setSlider(v.id, holes[current - 1])}>
          <Minus className="h-3.5 w-3.5" />
        </IconButton>
        <span className="num w-24 whitespace-nowrap text-center font-mono text-xs" aria-live="polite">
          Hole {current + 1} of {holes.length}
        </span>
        <IconButton label="Slide tandem one hole back" size="sm" variant="secondary" disabled={current === holes.length - 1} onClick={() => setSlider(v.id, holes[current + 1])}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <p className="flex-1 text-[11px] text-muted">
          Kingpin to tandem centre {formatLength(kingpinToAxle, sys, { big: true })}
          {best && !atBest && <> · best: hole {best.hole + 1}</>}
        </p>
        <Button size="sm" variant={atBest ? 'ghost' : 'secondary'} icon={<Crosshair className="h-3.5 w-3.5" />} disabled={!best || atBest} onClick={() => best && setSlider(v.id, best.x)}>
          {atBest ? 'At best position' : 'Best position'}
        </Button>
      </div>
    </div>
  );
}

function GrossRow({ axle, vehicle, sys, scale }: { axle: AxleState; vehicle: Vehicle; sys: UnitSystem; scale: number }) {
  const nearLimit = useEvaluation().plan.settings.nearLimit;
  const ratio = axle.grossKg / vehicle.grossLimitKg;
  const status = axle.grossOver ? 'over' : ratio >= nearLimit ? 'near' : 'legal';
  return (
    <div className="mt-2 border-t border-dashed border-line pt-2">
      <div className="mb-1 flex items-baseline gap-2 text-xs">
        <span className="flex-1 font-medium text-ink-soft">Gross weight</span>
        <span className={`num font-mono text-[11.5px] ${status === 'legal' ? 'text-ink' : STATUS_TEXT[status]}`}>
          {weightPair(axle.grossKg, vehicle.grossLimitKg, sys)}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-black/[0.06]">
        <div className={`h-full rounded-full ${STATUS_BAR[status]}`} style={{ width: `${Math.min(1, ratio / scale) * 100}%` }} />
        <span className="absolute -top-1 h-3.5 w-0.5 rounded bg-ink" style={{ left: `${(1 / scale) * 100}%` }} aria-hidden />
      </div>
    </div>
  );
}

/** Axle bars with limit/minimum ticks, contributor popovers, kingpin and gross weight, slider control. */
export function AxlePanel({ shown }: { shown: ShownState }) {
  const sys = useUnitSystem();
  const { axle, vehicleEval: ve, points } = shown;
  const v = ve.vehicle;
  const scale = Math.max(1.2, ...axle.axles.map((a) => a.ratio + 0.05), axle.grossKg / v.grossLimitKg + 0.05);
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          Axle loads <span className="text-[11px] font-normal text-muted">{shown.caption}</span>
        </span>
      }
      icon={<Scale />}
      right={<AxleStatusChip status={axle.status} />}
    >
      <div className="space-y-2">
        {axle.axles.map((a, i) => (
          <AxleBar key={a.id} load={a} groupIndex={i} vehicle={v} points={points} scale={scale} sys={sys} />
        ))}
      </div>
      {axle.kingpinKg !== undefined && (
        <div className="mt-2 flex items-baseline gap-2 text-xs">
          <span className="flex-1 text-ink-soft">Kingpin load</span>
          <span className="num font-mono text-[11.5px] text-ink">{formatWeight(axle.kingpinKg, sys)}</span>
        </div>
      )}
      <GrossRow axle={axle} vehicle={v} sys={sys} scale={scale} />
      <div className="mt-2 flex items-center gap-3 text-[10.5px] text-muted">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-0.5 rounded bg-ink" aria-hidden /> limit
        </span>
        {axle.axles.some((a) => a.minKg > 0) && (
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-0.5 rounded bg-info" aria-hidden /> minimum share
          </span>
        )}
        <span>Hover a bar for the top 5 contributors</span>
      </div>
      <SliderControl ve={ve} />
    </Section>
  );
}
