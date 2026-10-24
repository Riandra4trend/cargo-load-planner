import { Droplets, Mountain } from 'lucide-react';
import { isBulk } from '../../domain/geometry';
import { formatMass, formatPercent, formatWeight } from '../../domain/units';
import { useEvaluation, useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Chip, ColorDot } from '../common/Chip';
import { inputClass } from '../common/fields';
import { bulkCapacityL, bulkLabel, bulkState, bulkTitle, compartmentRows, formatBulkVolume, overload, unitLitres, unitState, volumePair, type CompartmentRow } from './bulk';
import { Section } from './Section';
import { lowerFirst, stopColorsBySeq } from './shellFormat';
import type { ShownState } from './useShownState';

const BAR_SCALE = 1.05;

function CompartmentItem({ row, vehicleId, tipper, aboard, options }: { row: CompartmentRow; vehicleId: string; tipper: boolean; aboard: Set<string> | null; options: { value: string; label: string }[] }) {
  const sys = useUnitSystem();
  const evaluation = useEvaluation();
  const assignCompartment = useStore((s) => s.assignCompartment);
  const unplaceUnits = useStore((s) => s.unplaceUnits);
  const setHover = useStore((s) => s.setHover);
  const colors = stopColorsBySeq(evaluation.plan);
  const { compartment: c, fills } = row;
  const first = fills[0];
  const state = first ? unitState(first) : tipper ? 'solid' : 'liquid';
  const discharged = !!first && aboard !== null && !aboard.has(first.id);
  const over = overload(row);
  const overfilled = row.fill > row.maxFill + 1e-9;
  const legalFrac = row.legal ? Math.min(row.legal.litres, row.volumeL) / c.capacityL : row.fill;
  const vios = fills.flatMap((u) => (evaluation.violationsByUnit.get(u.id) ?? []).filter((v) => v.kind === 'bulk' || v.kind === 'surge'));
  const uniqueVios = [...new Map(vios.map((v) => [v.id, v])).values()];
  const legalTick = row.legal && row.legal.limitedBy !== 'Capacity' ? row.legal.litres / c.capacityL : null;

  return (
    <li
      className={`rounded-lg px-1.5 py-1.5 -mx-1.5 transition-colors hover:bg-black/[0.03] ${discharged ? 'opacity-50' : ''} ${over.litres > 0 && !discharged ? 'bg-bad-soft/40' : ''}`}
      onMouseEnter={() => first && setHover(first.id)}
      onMouseLeave={() => setHover(null)}
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="num w-8 shrink-0 font-mono font-semibold text-ink">{c.label}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {first ? (
            <>
              <ColorDot color={row.color} />
              <span className="truncate font-medium text-ink">{first.spec.material?.name ?? first.spec.name}</span>
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
        <span className={`num w-16 shrink-0 text-right font-mono text-[11px] ${over.litres > 0 ? 'font-semibold text-bad' : 'text-ink-soft'}`}>{row.kg > 0 ? formatWeight(row.kg, sys) : '–'}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 pl-10">
        <div className="relative h-2 flex-1 rounded-full bg-black/[0.06]" title={`${formatPercent(row.fill)} full (max ${formatPercent(row.maxFill)})`}>
          <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150" style={{ width: `${Math.min(1, legalFrac / BAR_SCALE) * 100}%`, background: overfilled ? 'var(--color-bad)' : row.color }} />
          {over.litres > 0 && (
            <div
              className="absolute inset-y-0 rounded-r-full"
              style={{
                left: `${Math.min(1, legalFrac / BAR_SCALE) * 100}%`,
                width: `${Math.max(0, Math.min(1, row.fill / BAR_SCALE) - Math.min(1, legalFrac / BAR_SCALE)) * 100}%`,
                background: 'repeating-linear-gradient(135deg, var(--color-bad) 0 4px, color-mix(in srgb, var(--color-bad) 55%, white) 4px 7px)',
              }}
              aria-hidden
            />
          )}
          <span className="absolute -top-0.5 h-3 w-0.5 rounded bg-ink" style={{ left: `${(row.maxFill / BAR_SCALE) * 100}%` }} title={`Max fill ${formatPercent(row.maxFill)}`} aria-hidden />
          {legalTick !== null && legalTick < row.maxFill && (
            <span className="absolute -top-1 h-4 w-0.5 rounded bg-bad" style={{ left: `${(legalTick / BAR_SCALE) * 100}%` }} title="Legal maximum" aria-hidden />
          )}
        </div>
        <span className={`num shrink-0 font-mono text-[11px] ${over.litres > 0 || overfilled ? 'text-bad' : 'text-ink-soft'}`}>{volumePair(row.volumeL, c.capacityL, state, sys)}</span>
      </div>
      {row.blockedBy && !discharged && (
        <p className="mt-1 pl-10 text-[11px] text-warn">
          No legal volume here while the other cargo already breaks the {lowerFirst(row.blockedBy)} limit; rearrange the fills (Optimise).
        </p>
      )}
      {row.legal && !discharged && (
        <p className={`mt-1 pl-10 text-[11px] ${over.litres > 0 ? 'font-semibold text-bad' : 'text-muted'}`}>
          {over.litres > 0 ? (
            <>
              {row.legal.limitedBy === 'Capacity' ? 'Over max fill' : 'Overloaded'} by {formatBulkVolume(over.litres, state, sys)} ({formatMass(over.kg, sys)})
              <span className="font-normal"> · legal max {formatBulkVolume(row.legal.litres, state, sys)}, limited by {lowerFirst(row.legal.limitedBy)}</span>
            </>
          ) : (
            <>
              Legal max {formatBulkVolume(row.legal.litres, state, sys)} · limited by {lowerFirst(row.legal.limitedBy)}
            </>
          )}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1 pl-10">
        <select
          aria-label={`Contents of ${tipper ? 'the dump body' : `compartment ${c.label}`}`}
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
        {discharged && <Chip tone="info">{tipper ? 'Tipped' : 'Discharged'}</Chip>}
        {uniqueVios.map((v) => (
          <Chip key={v.id} tone={v.kind === 'surge' ? 'warn' : 'bad'} title={v.message}>
            {v.kind === 'surge' ? 'Surge' : tipper ? 'Body rule' : 'Tank rule'}
          </Chip>
        ))}
      </div>
    </li>
  );
}

/** Bulk compartments (tank compartments or dump body): material, volume vs capacity, max-fill tick, legal maximum (ODOL), stop and reassignment. */
export function BulkPanel({ shown }: { shown: ShownState }) {
  const sys = useUnitSystem();
  const evaluation = useEvaluation();
  const ve = shown.vehicleEval;
  const v = ve.vehicle;
  if (!v.bulk) return null;
  const plan = evaluation.plan;
  const tipper = v.bulk.kind === 'tipper';
  const state = bulkState(v);
  const rows = compartmentRows(plan, evaluation.units, v, ve.points);
  const capacity = bulkCapacityL(v);
  const used = rows.reduce((sum, r) => sum + r.volumeL, 0);
  const bulk = evaluation.units.filter((u) => isBulk(u.spec) && unitState(u) === state);
  const where = (id: string) => {
    const p = plan.placements[id];
    if (!p) return ' (unplaced)';
    const pv = plan.vehicles.find((x) => x.id === p.vehicleId);
    const c = pv?.bulk?.compartments.find((x) => x.id === p.compartmentId);
    return c ? (pv!.id === v.id ? ` (${c.label})` : ` (T${plan.vehicles.indexOf(pv!) + 1} ${c.label})`) : '';
  };
  const options = bulk.map((u) => ({ value: u.id, label: `${bulkLabel(u, sys)}${where(u.id)}` }));
  const aboard = shown.stage !== null && shown.stage > 0 ? new Set(ve.stages.find((s) => s.stage === shown.stage)?.unitIds ?? []) : null;
  const unplaced = bulk.filter((u) => !plan.placements[u.id]);
  const t = v.bulk;

  return (
    <Section title={bulkTitle(v)} icon={tipper ? <Mountain /> : <Droplets />} right={<span className="num font-mono text-[11px] text-ink-soft">{volumePair(used, capacity, state, sys)}</span>}>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {tipper ? (
          <Chip tone="neutral" className="!normal-case !tracking-normal" title="Level with the sides; heaping above them is over-dimension">
            Struck {formatBulkVolume(capacity, state, sys)}
          </Chip>
        ) : (
          <>
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
          </>
        )}
        <span className="num ml-auto text-[11px] text-muted">{formatPercent(capacity > 0 ? used / capacity : 0)} full</span>
      </div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <CompartmentItem key={r.compartment.id} row={r} vehicleId={v.id} tipper={tipper} aboard={aboard} options={options} />
        ))}
      </ul>
      {unplaced.length > 0 && (
        <p className="mt-2 text-[11px] text-bad">
          Not loaded: {unplaced.map((u) => `${u.spec.material?.name ?? u.spec.name} ${formatBulkVolume(unitLitres(u), state, sys)}`).join(', ')}
        </p>
      )}
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-0.5 rounded bg-ink" aria-hidden /> {tipper ? 'struck capacity (level with the sides)' : 'max safe fill'}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-0.5 rounded bg-bad" aria-hidden /> legal max (weight)
        </span>
        {!tipper && <span>Pick a fill to swap compartments.</span>}
      </p>
    </Section>
  );
}
