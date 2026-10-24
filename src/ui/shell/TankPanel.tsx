import { Droplets } from 'lucide-react';
import { isBulkLiquid } from '../../domain/geometry';
import { formatPercent, formatWeight } from '../../domain/units';
import { useEvaluation, useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Chip, ColorDot } from '../common/Chip';
import { inputClass } from '../common/fields';
import { Section } from './Section';
import { stopColorsBySeq } from './shellFormat';
import { bulkLabel, compartmentRows, formatCargoLitres, litrePair, tankCapacityL, unitLitres, type CompartmentRow } from './tanker';
import type { ShownState } from './useShownState';

function CompartmentItem({ row, vehicleId, aboard, options }: { row: CompartmentRow; vehicleId: string; aboard: Set<string> | null; options: { value: string; label: string }[] }) {
  const sys = useUnitSystem();
  const evaluation = useEvaluation();
  const assignCompartment = useStore((s) => s.assignCompartment);
  const unplaceUnits = useStore((s) => s.unplaceUnits);
  const setHover = useStore((s) => s.setHover);
  const colors = stopColorsBySeq(evaluation.plan);
  const { compartment: c, fills } = row;
  const first = fills[0];
  const discharged = !!first && aboard !== null && !aboard.has(first.id);
  const over = row.fill > row.maxFill + 1e-9;
  const vios = fills.flatMap((u) => (evaluation.violationsByUnit.get(u.id) ?? []).filter((v) => v.kind === 'tank' || v.kind === 'surge'));
  const uniqueVios = [...new Map(vios.map((v) => [v.id, v])).values()];
  const scale = 1.05;

  return (
    <li
      className={`rounded-lg px-1.5 py-1.5 -mx-1.5 transition-colors hover:bg-black/[0.03] ${discharged ? 'opacity-50' : ''}`}
      onMouseEnter={() => first && setHover(first.id)}
      onMouseLeave={() => setHover(null)}
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="num w-6 shrink-0 font-mono font-semibold text-ink">{c.label}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {first ? (
            <>
              <ColorDot color={row.color} />
              <span className="truncate font-medium text-ink">{first.spec.liquid?.name ?? first.spec.name}</span>
              {fills.length > 1 && <span className="text-bad">+{fills.length - 1}</span>}
            </>
          ) : (
            <span className="text-muted">empty</span>
          )}
        </span>
        {first && (
          <Chip tone="neutral" className="!normal-case !tracking-normal" title={evaluation.plan.stops.find((s) => s.sequence === first.stopSeq)?.name}>
            <ColorDot color={colors.get(first.stopSeq) ?? '#999'} size={7} />
            Stop {first.stopSeq}
          </Chip>
        )}
        <span className="num w-16 shrink-0 text-right font-mono text-[11px] text-ink-soft">{row.kg > 0 ? formatWeight(row.kg, sys) : '–'}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 pl-8">
        <div className="relative h-2 flex-1 rounded-full bg-black/[0.06]" title={`${formatPercent(row.fill)} full (max ${formatPercent(row.maxFill)})`}>
          <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${Math.min(1, row.fill / scale) * 100}%`, background: over ? 'var(--color-bad)' : row.color }} />
          <span className="absolute -top-0.5 h-3 w-0.5 rounded bg-ink" style={{ left: `${(row.maxFill / scale) * 100}%` }} aria-hidden />
        </div>
        <span className={`num shrink-0 font-mono text-[11px] ${over ? 'text-bad' : 'text-ink-soft'}`}>
          {litrePair(row.volumeL, c.capacityL, sys)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 pl-8">
        <select
          aria-label={`Contents of compartment ${c.label}`}
          value={first?.id ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            if (id) assignCompartment(id, vehicleId, c.id);
            else if (fills.length) unplaceUnits(fills.map((u) => u.id));
          }}
          className={`${inputClass} !h-7 !w-auto min-w-0 flex-1 !px-1.5 !text-[11px]`}
        >
          <option value="">Empty</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {discharged && <Chip tone="info">Discharged</Chip>}
        {uniqueVios.map((v) => (
          <Chip key={v.id} tone={v.kind === 'surge' ? 'warn' : 'bad'} title={v.message}>
            {v.kind === 'surge' ? 'Surge' : 'Tank rule'}
          </Chip>
        ))}
      </div>
    </li>
  );
}

/** Tanker compartments: liquid, volume vs capacity with the max-fill tick, weight, stop, reassignment and tank warnings. */
export function TankPanel({ shown }: { shown: ShownState }) {
  const sys = useUnitSystem();
  const evaluation = useEvaluation();
  const v = shown.vehicleEval.vehicle;
  if (!v.tank) return null;
  const plan = evaluation.plan;
  const rows = compartmentRows(plan, evaluation.units, v);
  const capacity = tankCapacityL(v);
  const used = rows.reduce((sum, r) => sum + r.volumeL, 0);
  const bulk = evaluation.units.filter((u) => isBulkLiquid(u.spec));
  const where = (id: string) => {
    const p = plan.placements[id];
    if (!p) return ' (unplaced)';
    const pv = plan.vehicles.find((x) => x.id === p.vehicleId);
    const c = pv?.tank?.compartments.find((x) => x.id === p.compartmentId);
    return c ? (pv!.id === v.id ? ` (${c.label})` : ` (T${plan.vehicles.indexOf(pv!) + 1} ${c.label})`) : '';
  };
  const options = bulk.map((u) => ({ value: u.id, label: `${bulkLabel(u, sys)}${where(u.id)}` }));
  const aboard = shown.stage !== null && shown.stage > 0 ? new Set(shown.vehicleEval.stages.find((s) => s.stage === shown.stage)?.unitIds ?? []) : null;
  const t = v.tank;

  return (
    <Section
      title="Tank compartments"
      icon={<Droplets />}
      right={<span className="num font-mono text-[11px] text-ink-soft">{litrePair(used, capacity, sys)}</span>}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <Chip tone={t.baffled ? 'ok' : 'neutral'} title={t.baffled ? 'Surge baffles make partial fills safe' : 'No baffles: fill compartments below 20 % or above 80 %'}>
          {t.baffled ? 'Baffled' : 'Unbaffled'}
        </Chip>
        {t.foodGrade && <Chip tone="ok">Food-grade</Chip>}
        {t.insulated && <Chip tone="info">Insulated</Chip>}
        {t.pressurised && (
          <Chip tone="accent" title="Pressure vessel for liquefied gases">
            Pressurised
          </Chip>
        )}
        <span className="num ml-auto text-[11px] text-muted">{formatPercent(capacity > 0 ? used / capacity : 0)} full</span>
      </div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <CompartmentItem key={r.compartment.id} row={r} vehicleId={v.id} aboard={aboard} options={options} />
        ))}
      </ul>
      {bulk.some((u) => !plan.placements[u.id]) && (
        <p className="mt-2 text-[11px] text-bad">
          Not in a tank: {bulk.filter((u) => !plan.placements[u.id]).map((u) => `${u.spec.liquid?.name ?? u.spec.name} ${formatCargoLitres(unitLitres(u), sys)}`).join(', ')}
        </p>
      )}
      <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted">
        <span className="h-2.5 w-0.5 rounded bg-ink" aria-hidden /> max safe fill (expansion space). Pick a fill to swap compartments.
      </p>
    </Section>
  );
}
