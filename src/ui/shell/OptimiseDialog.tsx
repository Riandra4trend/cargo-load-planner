import { ArrowRight, Loader2, PackageX, Sparkles, TriangleAlert, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { unitIdOf } from '../../domain/geometry';
import { uid } from '../../domain/ids';
import { sliderPositions } from '../../domain/presets';
import type { Plan, Vehicle } from '../../domain/types';
import { formatLength, formatMass, formatPercent } from '../../domain/units';
import { proposeVehicles } from '../../packing';
import { evaluatePlan, type VehicleEval } from '../../state/evaluate';
import { useStore, type OptimiseState } from '../../state/store';
import { Button } from '../common/Button';
import { Chip } from '../common/Chip';
import { Modal } from '../common/Modal';
import { STATUS_SOFT } from './shellFormat';

function sliderHole(v: Vehicle): string | null {
  const holes = sliderPositions(v);
  if (v.statics.type !== 'artic' || !holes.length) return null;
  const x = v.statics.trailerAxle.x;
  const i = holes.reduce((bi, h, j) => (Math.abs(h - x) < Math.abs(holes[bi] - x) ? j : bi), 0);
  return `hole ${i + 1} of ${holes.length}`;
}

function Compare({ label, before, after, better }: { label: string; before: ReactNode; after: ReactNode; better?: boolean | null }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-1.5 pr-3 text-left text-xs font-medium text-ink-soft">
        {label}
      </th>
      <td className="num py-1.5 pr-2 text-right font-mono text-xs text-muted">{before}</td>
      <td className="px-1 text-muted">
        <ArrowRight className="h-3 w-3" aria-label="to" />
      </td>
      <td className={`num py-1.5 pl-2 text-right font-mono text-xs font-semibold ${better === true ? 'text-ok' : better === false ? 'text-bad' : 'text-ink'}`}>{after}</td>
    </tr>
  );
}

function StageStrip({ ve, label }: { ve: VehicleEval; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-12 shrink-0 text-[11px] text-muted">{label}</span>
      {ve.stages.map((st) => {
        const worst = st.axle.axles.reduce((w, a) => (a.ratio > w.ratio ? a : w), st.axle.axles[0]);
        return (
          <span key={st.stage} title={`${st.label}: ${worst.label} ${formatPercent(worst.ratio)} (${st.axle.status})`} className={`num rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold ${STATUS_SOFT[st.axle.status]}`}>
            {formatPercent(worst.ratio)}
          </span>
        );
      })}
    </div>
  );
}

function VehicleDiff({ base, preview, vehicleId }: { base: Plan; preview: Plan; vehicleId: string }) {
  const b = evaluatePlan(base).byVehicle[vehicleId];
  const a = evaluatePlan(preview).byVehicle[vehicleId];
  if (!a || !b) return null;
  const sys = preview.settings.units;
  const count = (ve: VehicleEval, sev: 'error' | 'warning') => ve.violations.filter((x) => x.severity === sev).length;
  const holeB = sliderHole(b.vehicle);
  const holeA = sliderHole(a.vehicle);
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Truck className="h-4 w-4 text-muted" aria-hidden /> {a.vehicle.name}
      </p>
      <div className="mb-2 space-y-1">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">Worst axle per stage ({a.stages.map((s) => s.label).join(' · ')})</p>
        <StageStrip ve={b} label="Before" />
        <StageStrip ve={a} label="After" />
      </div>
      <table className="w-full">
        <tbody>
          <Compare label="Errors" before={count(b, 'error')} after={count(a, 'error')} better={count(a, 'error') === count(b, 'error') ? null : count(a, 'error') < count(b, 'error')} />
          <Compare label="Warnings" before={count(b, 'warning')} after={count(a, 'warning')} better={count(a, 'warning') === count(b, 'warning') ? null : count(a, 'warning') < count(b, 'warning')} />
          <Compare label="Units aboard" before={b.fill.units} after={a.fill.units} better={a.fill.units === b.fill.units ? null : a.fill.units > b.fill.units} />
          <Compare label="Remaining capacity" before={formatMass(b.remaining.kg, sys)} after={formatMass(a.remaining.kg, sys)} better={Math.abs(a.remaining.kg - b.remaining.kg) < 1 ? null : a.remaining.kg > b.remaining.kg} />
          <Compare
            label="Cargo COG from front"
            before={b.axle.cog ? formatLength(b.axle.cog.x, sys, { big: true }) : '–'}
            after={a.axle.cog ? formatLength(a.axle.cog.x, sys, { big: true }) : '–'}
          />
          {(holeA || holeB) && <Compare label="Slider" before={holeB ?? '–'} after={holeA ?? '–'} />}
        </tbody>
      </table>
    </div>
  );
}

function DiffBody({ diff }: { diff: NonNullable<OptimiseState['diff']> }) {
  const { base, preview, outcome } = diff;
  const evaluation = evaluatePlan(preview);
  const discardOptimise = useStore((s) => s.discardOptimise);
  const addVehicle = useStore((s) => s.addVehicle);
  const startOptimise = useStore((s) => s.startOptimise);
  const addSecondVehicle = () => {
    // Propose a vehicle for the leftover units only (e.g. a reefer when they need temperature control).
    const left = new Set(outcome.unplaced.map((u) => u.unitId));
    const leftover: Plan = {
      ...base,
      placements: {},
      lines: base.lines.flatMap((l) => {
        const quantity = Array.from({ length: l.quantity }, (_, i) => unitIdOf(l.id, i)).filter((id) => left.has(id)).length;
        return quantity ? [{ ...l, quantity }] : [];
      }),
    };
    const [proposed] = proposeVehicles(leftover);
    const template = base.vehicles.find((v) => v.id === outcome.vehicleIds[0]) ?? base.vehicles[0];
    discardOptimise();
    addVehicle(proposed ?? (template.presetId === 'custom' ? { ...structuredClone(template), id: uid('veh') } : template.presetId));
    startOptimise();
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Chip tone="accent">
          <Sparkles className="h-3 w-3" aria-hidden /> {outcome.moved} unit{outcome.moved === 1 ? '' : 's'} moved
        </Chip>
        {outcome.unplaced.length > 0 ? <Chip tone="bad">{outcome.unplaced.length} not placed</Chip> : <Chip tone="ok">Everything placed</Chip>}
        <span className="num text-xs text-muted">
          {outcome.iterations.toLocaleString('en-US')} iterations in {(outcome.ms / 1000).toFixed(1)} s
        </span>
      </div>
      <p className="text-xs text-muted">The 3D view, panels and KPIs show the result now. Accept to keep it, or revert to the previous plan.</p>
      <div className={`grid gap-3 ${outcome.vehicleIds.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {outcome.vehicleIds.map((id) => (
          <VehicleDiff key={id} base={base} preview={preview} vehicleId={id} />
        ))}
      </div>
      {outcome.unplaced.length > 0 && (
        <div className="rounded-xl border border-bad/30 bg-bad-soft/40 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-bad">
            <PackageX className="h-4 w-4" aria-hidden /> Not placed
          </p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
            {outcome.unplaced.map((u) => {
              const unit = evaluation.unitById.get(u.unitId);
              return (
                <li key={u.unitId} className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{unit ? `${unit.spec.name} #${unit.index + 1}` : u.unitId}</span>
                  <span className="text-ink-soft">{u.reason}</span>
                </li>
              );
            })}
          </ul>
          <Button size="sm" className="mt-2" icon={<Truck className="h-3.5 w-3.5" />} onClick={addSecondVehicle}>
            Add a second vehicle and re-optimise
          </Button>
        </div>
      )}
    </div>
  );
}

/** Optimiser progress (with Cancel), error, and before/after diff with Accept / Revert. */
export function OptimiseDialog() {
  const opt = useStore((s) => s.ui.optimise);
  const cancelOptimise = useStore((s) => s.cancelOptimise);
  const acceptOptimise = useStore((s) => s.acceptOptimise);
  const discardOptimise = useStore((s) => s.discardOptimise);
  const open = opt.running || !!opt.diff || !!opt.error;
  const close = opt.running ? cancelOptimise : discardOptimise;

  let title = 'Optimise';
  let body: ReactNode = null;
  let footer: ReactNode = null;
  if (opt.running) {
    title = 'Optimising the load…';
    body = (
      <div role="status" aria-live="polite">
        <div className="mb-2 flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
          Packing, checking axle loads at every stop and improving the layout.
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-black/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(opt.progress * 100)}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(2, opt.progress * 100)}%` }} />
        </div>
        <p className="num mt-1 text-right text-xs text-muted">{Math.round(opt.progress * 100)} %</p>
      </div>
    );
    footer = (
      <Button variant="secondary" onClick={cancelOptimise}>
        Cancel
      </Button>
    );
  } else if (opt.diff) {
    title = 'Optimiser result';
    body = <DiffBody diff={opt.diff} />;
    footer = (
      <>
        <Button variant="secondary" onClick={discardOptimise}>
          Revert
        </Button>
        <Button variant="primary" onClick={acceptOptimise}>
          Accept
        </Button>
      </>
    );
  } else if (opt.error) {
    title = 'Optimise failed';
    body = (
      <p className="flex items-start gap-2 text-sm text-bad">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {opt.error}
      </p>
    );
    footer = (
      <Button variant="secondary" onClick={discardOptimise}>
        Close
      </Button>
    );
  }

  return (
    <Modal open={open} onClose={close} title={title} icon={<Sparkles />} width={opt.diff ? 'max-w-3xl' : 'max-w-md'} footer={footer}>
      {body}
    </Modal>
  );
}
