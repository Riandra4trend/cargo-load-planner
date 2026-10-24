import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { TEMP_LABELS } from '../../domain/colors';
import { isBulk } from '../../domain/geometry';
import { DISCLAIMER } from '../../domain/settings';
import type { CargoUnit, Plan, UnitSystem, Vehicle } from '../../domain/types';
import { formatConsumption, formatDims, formatDistance, formatLength, formatLitres, formatMass, formatMaterialDensity, formatMoney, formatPercent, formatWeight } from '../../domain/units';
import { routeKm } from '../../physics/fuel';
import { loadingSequence } from '../../sim/sequence';
import { evaluatePlan, type VehicleEval } from '../../state/evaluate';
import { useDisplayPlan } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Button } from '../common/Button';
import { AxleStatusChip, ColorDot } from '../common/Chip';
import { Modal } from '../common/Modal';
import { PlanDiagram, PlanLegend } from './PlanDiagram';
import { countLabel, formatPlanDate, lowerFirst, SEVERITY_LABEL, SEVERITY_ORDER, STATUS_TEXT, stageShort, weightPair } from './shellFormat';
import { bulkState, bulkSummary, bulkTitle, compartmentRows, formatBulkVolume, frontLabel, overload, packagedContents, unitLitres, unitState, volumePair, type CompartmentRow } from './bulk';

const DIAGRAM_WIDTH = 700;

function FuelReport({ plan, ve }: { plan: Plan; ve: VehicleEval }) {
  const sys = plan.settings.units;
  const f = ve.fuel;
  if (!f.legs.length) return <p className="text-[11.5px] text-muted">No cargo on this vehicle, so it does not drive the route.</p>;
  return (
    <>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
            <th className="py-1 pr-2">Leg</th>
            <th className="px-2 py-1 text-right">Distance</th>
            <th className="px-2 py-1 text-right">Cargo aboard</th>
            <th className="px-2 py-1 text-right">Consumption</th>
            <th className="py-1 pl-2 text-right">Fuel</th>
          </tr>
        </thead>
        <tbody>
          {f.legs.map((leg) => (
            <tr key={leg.label} className="border-t border-line">
              <td className="py-1 pr-2">
                {leg.label}
                {leg.cold && <span className="text-muted"> · reefer on</span>}
              </td>
              <td className="num px-2 py-1 text-right font-mono text-[10.5px]">{formatDistance(leg.km, sys, 1)}</td>
              <td className="num px-2 py-1 text-right font-mono text-[10.5px]">{formatMass(leg.cargoKg, sys)}</td>
              <td className="num px-2 py-1 text-right font-mono text-[10.5px]">{formatConsumption(leg.lPer100km, sys)}</td>
              <td className="num py-1 pl-2 text-right font-mono text-[10.5px]">{formatLitres(leg.litres, sys)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px]">
        <span className="font-semibold">
          Total {formatLitres(f.totalL, sys)} · {formatMoney(f.cost, plan.settings.currency)} · CO₂ {formatMass(f.co2Kg, sys)}
        </span>
        <span className="text-muted">
          {' '}
          · driving {formatLitres(f.drivingL, sys)} ({formatConsumption(f.avgLPer100km, sys)} average){f.reeferL > 0 ? ` · reefer ${formatLitres(f.reeferL, sys)}` : ''} · idling {formatLitres(f.idleL, sys)} ·{' '}
          {formatPercent(f.tankShare)} of the {formatLitres(ve.vehicle.fuel.tankL, sys, 0)} tank
        </span>
      </p>
    </>
  );
}

/** "22.61 t · 5 fills · 28,300 L", "17.38 t · 26 units", or both counts for mixed plans (liquid and solid volumes listed apart). */
function totalCargoText(units: readonly CargoUnit[], totalKg: number, sys: UnitSystem): string {
  const fills = units.filter((u) => isBulk(u.spec));
  const others = units.length - fills.length;
  const parts = [formatMass(totalKg, sys)];
  if (others > 0 || fills.length === 0) parts.push(countLabel(others, 'unit'));
  if (fills.length > 0) parts.push(countLabel(fills.length, 'fill'));
  for (const state of ['liquid', 'solid'] as const) {
    const litres = fills.filter((u) => unitState(u) === state).reduce((sum, u) => sum + unitLitres(u), 0);
    if (litres > 0) parts.push(formatBulkVolume(litres, state, sys));
  }
  return parts.join(' · ');
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-[12px] text-ink">{value || '–'}</dd>
    </div>
  );
}

function H({ children }: { children: string }) {
  return <h3 className="mb-1.5 mt-4 border-b border-line pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">{children}</h3>;
}

/** Bulk section (tanker or dump truck): compartment table with the legal maximum, loading order and discharge / tipping order per stop. */
function BulkReport({ plan, ve }: { plan: Plan; ve: VehicleEval }) {
  const sys = plan.settings.units;
  const v = ve.vehicle;
  const tipper = v.bulk?.kind === 'tipper';
  const state = bulkState(v);
  const evaluation = evaluatePlan(plan);
  const rows = compartmentRows(plan, evaluation.units, v, ve.points);
  const customers = new Map(plan.customers.map((c) => [c.id, c.name]));
  const stopsBySeq = new Map(plan.stops.map((s) => [s.sequence, s]));
  const filled = rows.filter((r) => r.fills.length > 0);
  const bySeq = new Map<number, CompartmentRow[]>();
  for (const r of filled) for (const u of r.fills) bySeq.set(u.stopSeq, [...(bySeq.get(u.stopSeq) ?? []), { ...r, fills: [u] }]);
  const fillText = (r: CompartmentRow) =>
    `${tipper ? '' : `${r.compartment.label} `}${r.fills[0].spec.material?.name ?? r.fills[0].spec.name} ${formatBulkVolume(unitLitres(r.fills[0]), unitState(r.fills[0]), sys)}`;
  const cell = 'num px-2 py-1 text-right font-mono text-[10.5px]';
  return (
    <>
      <H>{bulkTitle(v)}</H>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
            <th className="py-1 pr-2">{tipper ? 'Body' : 'Comp.'}</th>
            <th className="px-2 py-1 text-right">Capacity</th>
            <th className="px-2 py-1">Material</th>
            {tipper ? <th className="px-2 py-1 text-right">Density</th> : <th className="px-2 py-1">UN / class</th>}
            <th className="px-2 py-1 text-right">Volume</th>
            <th className="px-2 py-1 text-right">Fill</th>
            <th className="px-2 py-1 text-right">Weight</th>
            <th className="px-2 py-1 text-right">Legal max</th>
            <th className="px-2 py-1">Binding limit</th>
            <th className="py-1 pl-2">Stop / customer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const u = r.fills[0];
            const m = u?.spec.material;
            const stop = u ? stopsBySeq.get(u.stopSeq) : undefined;
            const over = overload(r);
            return (
              <tr key={r.compartment.id} className="border-t border-line">
                <td className="py-1 pr-2 font-mono font-semibold">{r.compartment.label}</td>
                <td className={cell}>{formatBulkVolume(r.compartment.capacityL, m?.state ?? state, sys)}</td>
                <td className="px-2 py-1">
                  {u ? (
                    <span className="flex items-center gap-1.5">
                      <ColorDot color={r.color} size={8} />
                      {m?.name ?? u.spec.name}
                      {r.fills.length > 1 && <span className="text-bad"> +{r.fills.length - 1}</span>}
                    </span>
                  ) : (
                    <span className="text-muted">empty</span>
                  )}
                </td>
                {tipper ? (
                  <td className={cell}>{m ? formatMaterialDensity(m.densityKgPerL, m.state, sys) : '–'}</td>
                ) : (
                  <td className="px-2 py-1">{u?.spec.hazmat ? `${u.spec.hazmat.unNumber} · cl. ${u.spec.hazmat.hazClass}` : '–'}</td>
                )}
                <td className={`${cell} ${over.litres > 0 ? 'font-semibold text-bad' : ''}`}>{u ? formatBulkVolume(r.volumeL, m?.state ?? state, sys) : '–'}</td>
                <td className={`${cell} ${r.fill > r.maxFill + 1e-9 ? 'text-bad' : ''}`}>{u ? formatPercent(r.fill) : '–'}</td>
                <td className={`${cell} ${over.litres > 0 ? 'font-semibold text-bad' : ''}`}>{u ? formatWeight(r.kg, sys) : '–'}</td>
                <td className={cell}>{r.legal && m ? formatBulkVolume(r.legal.litres, m.state, sys) : '–'}</td>
                <td className="px-2 py-1">
                  {r.legal ? lowerFirst(r.legal.limitedBy) : r.blockedBy ? <span className="text-warn">other cargo breaks the {lowerFirst(r.blockedBy)}</span> : '–'}
                  {over.litres > 0 && (
                    <span className="block font-semibold text-bad">
                      overloaded by {formatBulkVolume(over.litres, m?.state ?? state, sys)} ({formatMass(over.kg, sys)})
                    </span>
                  )}
                </td>
                <td className="py-1 pl-2">{u ? `${u.stopSeq} · ${stop ? (customers.get(stop.customerId) ?? stop.name) : ''}` : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <H>{tipper ? 'Loading' : 'Filling order'}</H>
      {filled.length === 0 ? (
        <p className="text-[11.5px] text-muted">{tipper ? 'The body is empty.' : 'No fills on this tanker.'}</p>
      ) : (
        <p className="text-[11px] leading-relaxed">{filled.map(fillText).join(' → ')}</p>
      )}
      <H>{tipper ? 'Tipping order' : 'Discharge order'}</H>
      {bySeq.size === 0 ? (
        <p className="text-[11.5px] text-muted">{tipper ? 'Nothing to tip.' : 'Nothing to discharge.'}</p>
      ) : (
        <ol className="space-y-0.5 text-[11px]">
          {[...bySeq.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([seq, list]) => (
              <li key={seq}>
                <span className="font-semibold">
                  Stop {seq} · {stopsBySeq.get(seq)?.name ?? ''}:
                </span>{' '}
                {list.map(fillText).join(', ')}
              </li>
            ))}
        </ol>
      )}
    </>
  );
}

function VehicleReport({ plan, ve }: { plan: Plan; ve: VehicleEval }) {
  const sys = plan.settings.units;
  const v: Vehicle = ve.vehicle;
  const evaluation = evaluatePlan(plan);
  const steps = loadingSequence(plan, v.id);
  const stopName = new Map(plan.stops.map((s) => [s.sequence, s.name]));
  const ratios = ve.stages.map((st) => Math.max(...st.axle.axles.map((a) => a.ratio)));
  const worstStage = ratios.indexOf(Math.max(...ratios));
  return (
    <section className="report-vehicle mt-5">
      <div className="flex items-baseline gap-2 border-b-2 border-ink pb-1">
        <h2 className="flex-1 text-[15px] font-semibold">{v.name}</h2>
        <span className="num text-[11px] text-muted">
          {v.bulk ? bulkSummary(v, sys) : formatDims(v.cargo, sys, { big: true })} · payload {formatMass(v.payloadKg, sys)} · GVW/GCW{' '}
          {formatMass(v.grossLimitKg, sys)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-3 text-[11.5px]">
        <MetaItem label="Cargo weight" value={`${formatMass(ve.axle.cargoKg, sys)} (${formatPercent(ve.fill.weight)} of payload)`} />
        {v.bulk ? (
          <MetaItem
            label="Fills · volume"
            value={`${countLabel(ve.fill.units, 'fill')} · ${volumePair(ve.fill.placedVolume * 1000, ve.fill.usableVolume * 1000, bulkState(v), sys)} (${formatPercent(ve.fill.volume)})`}
          />
        ) : (
          <MetaItem label="Units · volume" value={`${countLabel(ve.fill.units, 'unit')} · ${formatPercent(ve.fill.volume)}`} />
        )}
        <MetaItem label="Remaining capacity" value={ve.remaining.kg > 0 ? `${formatMass(ve.remaining.kg, sys)} (${lowerFirst(ve.remaining.limitedBy)})` : `none: ${lowerFirst(ve.remaining.limitedBy)}`} />
        <MetaItem
          label="Cargo COG"
          value={ve.axle.cog ? `${formatLength(ve.axle.cog.x, sys, { big: true })} from ${v.bulk ? frontLabel(v) : 'front'}, ${formatLength(ve.axle.cog.z, sys, { big: true })} high` : 'empty'}
        />
      </div>

      <div className="report-diagrams">
        {v.bulk ? (
          <>
            <H>{v.bulk.kind === 'tipper' ? 'Dump body (side view)' : 'Tank compartments (side view)'}</H>
            <PlanDiagram plan={plan} vehicleId={v.id} mode="side" width={DIAGRAM_WIDTH} />
            <H>Top view</H>
            <PlanDiagram plan={plan} vehicleId={v.id} mode="top" width={DIAGRAM_WIDTH} />
          </>
        ) : (
          <>
            <H>Floor plan (top view)</H>
            <PlanDiagram plan={plan} vehicleId={v.id} mode="top" width={DIAGRAM_WIDTH} />
            <H>Side elevation</H>
            <PlanDiagram plan={plan} vehicleId={v.id} mode="side" width={DIAGRAM_WIDTH} />
          </>
        )}
        <div className="mt-2">
          <PlanLegend plan={plan} vehicleId={v.id} />
        </div>
      </div>

      {v.bulk ? (
        <BulkReport plan={plan} ve={ve} />
      ) : (
        <>
          <H>Loading instructions (forklift order)</H>
          {steps.length === 0 ? (
            <p className="text-[11.5px] text-muted">No units on this vehicle.</p>
          ) : (
            <ol className="columns-2 gap-6 text-[11px] leading-snug">
              {steps.map((s, i) => (
                <li key={s.unitId} className="mb-0.5 flex break-inside-avoid gap-1.5">
                  <span className="num w-12 shrink-0 font-mono font-semibold">Step {i + 1}</span>
                  <span>
                    {s.name} → {s.position}
                    <span className="text-muted">
                      {' '}
                      · {evaluation.bayOfUnit[s.unitId]} · stop {s.stopSeq}
                      {stopName.get(s.stopSeq) ? ` (${stopName.get(s.stopSeq)})` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <H>Axle loads per stage</H>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
            <th className="py-1 pr-2">Stage</th>
            {ve.stages[0].axle.axles.map((a) => (
              <th key={a.id} className="px-2 py-1 text-right">
                {a.label}
              </th>
            ))}
            <th className="px-2 py-1 text-right">Gross</th>
            <th className="py-1 pl-2 text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {ve.stages.map((st, i) => (
            <tr key={st.stage} className={`border-t border-line ${i === worstStage && st.axle.status !== 'legal' ? 'font-semibold' : ''}`}>
              <td className="py-1 pr-2">{st.label}</td>
              {st.axle.axles.map((a) => (
                <td key={a.id} className={`num px-2 py-1 text-right font-mono text-[10.5px] ${STATUS_TEXT[a.status]}`}>
                  <span className="block whitespace-nowrap">{weightPair(a.kg, a.maxKg, sys)}</span>
                  <span className="block">{formatPercent(a.ratio)}</span>
                </td>
              ))}
              <td className={`num whitespace-nowrap px-2 py-1 text-right font-mono text-[10.5px] ${st.axle.grossOver ? 'text-bad' : ''}`}>{weightPair(st.axle.grossKg, v.grossLimitKg, sys)}</td>
              <td className="py-1 pl-2 text-right">
                <AxleStatusChip status={st.axle.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <H>Fuel estimate</H>
      <FuelReport plan={plan} ve={ve} />

      <H>Violations and warnings</H>
      {ve.violations.length === 0 ? (
        <p className="text-[11.5px] text-ok">All checks pass at departure and after every stop.</p>
      ) : (
        SEVERITY_ORDER.map((sev) => {
          const list = ve.violations.filter((x) => x.severity === sev);
          if (!list.length) return null;
          return (
            <div key={sev} className="mb-1.5">
              <p className={`text-[10.5px] font-semibold uppercase tracking-wide ${sev === 'error' ? 'text-bad' : sev === 'warning' ? 'text-warn' : 'text-info'}`}>
                {SEVERITY_LABEL[sev]} ({list.length})
              </p>
              <ul className="list-disc pl-5 text-[11px]">
                {list.map((x) => (
                  <li key={x.id}>
                    {x.message}
                    {x.stage !== undefined && <span className="text-muted"> · {stageShort(x.stage)}</span>}
                    {x.fix && <span className="text-muted"> · suggestion: {x.fix.label}</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

/** Full printable load report of a plan (header, diagrams, loading steps, items, axle loads, checks, disclaimer). */
export function ReportView({ plan }: { plan: Plan }) {
  const evaluation = evaluatePlan(plan);
  const sys = plan.settings.units;
  const m = plan.meta;
  const customers = new Map(plan.customers.map((c) => [c.id, c.name]));
  const stops = new Map(plan.stops.map((s) => [s.id, s]));
  const vehicleIndex = new Map(plan.vehicles.map((v, i) => [v.id, i + 1]));
  const lines = [...plan.lines].sort((a, b) => (stops.get(a.stopId)?.sequence ?? 0) - (stops.get(b.stopId)?.sequence ?? 0));
  const generated = new Date();
  return (
    <article className="report bg-white text-ink">
      <header className="flex items-start gap-3 border-b-2 border-ink pb-2">
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">LoadPlanner 3D · load plan report</p>
          <h1 className="text-[20px] font-semibold leading-tight">{plan.name}</h1>
        </div>
        <p className="num text-right text-[10px] text-muted">
          Generated {generated.toLocaleDateString('en-GB')} {generated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </header>
      <dl className="mt-2 grid grid-cols-4 gap-3">
        <MetaItem label="Departure" value={`${formatPlanDate(m.date)} ${m.date.slice(0, 4)}, ${m.time}`} />
        <MetaItem label="Dock" value={m.dock} />
        <MetaItem label="Route" value={`${m.route ? `${m.route} · ` : ''}${plan.stops.length} stops`} />
        <MetaItem label="Distance" value={routeKm(plan) > 0 ? formatDistance(routeKm(plan), sys) : ''} />
        <MetaItem label="Driver" value={m.driver} />
        <MetaItem label="Vehicles" value={plan.vehicles.map((v) => v.name).join(', ')} />
        <MetaItem label="Total cargo" value={totalCargoText(evaluation.units, evaluation.totalKg, sys)} />
        <MetaItem label="Orders loaded" value={`${evaluation.orders.loaded} of ${evaluation.orders.total}`} />
        <MetaItem label="Fuel (estimate)" value={evaluation.fuel.litres > 0 ? `${formatLitres(evaluation.fuel.litres, sys)} · ${formatMoney(evaluation.fuel.cost, plan.settings.currency)}` : ''} />
      </dl>
      {m.notes && <p className="mt-2 whitespace-pre-wrap rounded border border-line p-2 text-[11px]">{m.notes}</p>}

      {plan.vehicles.map((v) => (
        <VehicleReport key={v.id} plan={plan} ve={evaluation.byVehicle[v.id]} />
      ))}

      <section className="mt-5">
        <H>Item list</H>
        <table className="w-full text-[10.5px]">
          <thead>
            <tr className="text-left text-[9.5px] uppercase tracking-wide text-muted">
              <th className="py-1 pr-1.5">Stop</th>
              <th className="px-1.5 py-1">Item</th>
              <th className="px-1.5 py-1">SKU</th>
              <th className="px-1.5 py-1 text-right">Qty</th>
              <th className="px-1.5 py-1">{lines.some((l) => isBulk(l.spec)) ? 'Dimensions / volume' : 'Dimensions'}</th>
              <th className="px-1.5 py-1 text-right">Weight / unit</th>
              <th className="px-1.5 py-1">Handling</th>
              <th className="py-1 pl-1.5">Placed</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const stop = stops.get(l.stopId);
              const units = evaluation.units.filter((u) => u.lineId === l.id);
              const placed = units.filter((u) => plan.placements[u.id]);
              const bulk = isBulk(l.spec);
              const where = [
                ...new Set(
                  placed.map((u) => {
                    const p = plan.placements[u.id];
                    const bay = bulk ? evaluation.bayOfUnit[u.id] : undefined;
                    return `T${vehicleIndex.get(p.vehicleId)}${bay ? ` ${bay}` : ''}`;
                  }),
                ),
              ].join(', ');
              const contents = packagedContents(l, sys);
              const handling = [
                l.spec.temp !== 'ambient' ? TEMP_LABELS[l.spec.temp] : '',
                l.spec.hazmat ? `${l.spec.hazmat.unNumber} cl. ${l.spec.hazmat.hazClass}` : '',
                l.spec.material ? formatMaterialDensity(l.spec.material.densityKgPerL, l.spec.material.state, sys) : '',
                l.spec.fragile ? 'fragile' : '',
                bulk ? 'bulk' : l.spec.stackable ? `stack ≤ ${l.spec.maxStackLayers}` : 'no stack',
                l.priority === 'urgent' ? 'urgent' : '',
              ].filter(Boolean);
              return (
                <tr key={l.id} className="border-t border-line align-top">
                  <td className="py-1 pr-1.5">
                    <span className="num font-semibold">{stop?.sequence ?? '–'}</span> {stop ? customers.get(stop.customerId) : ''}
                  </td>
                  <td className="px-1.5 py-1">
                    {l.spec.name}
                    {contents && <span className="block text-muted">{contents}</span>}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1 font-mono">{l.spec.sku}</td>
                  <td className="num px-1.5 py-1 text-right">{l.quantity}</td>
                  <td className="num whitespace-nowrap px-1.5 py-1">{bulk ? formatBulkVolume(l.spec.material?.volumeL ?? 0, unitState(l), sys) : formatDims(l.spec.dims, sys)}</td>
                  <td className="num px-1.5 py-1 text-right">{formatWeight(l.spec.weightKg, sys)}</td>
                  <td className="px-1.5 py-1">{handling.join(', ')}</td>
                  <td className={`py-1 pl-1.5 ${placed.length < units.length ? 'text-bad' : ''}`}>
                    {placed.length} / {units.length}
                    {where && <span className="text-muted"> · {where}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {evaluation.unplaced.length > 0 && (
          <p className="mt-1.5 text-[11px] text-bad">
            Not loaded: {evaluation.unplaced.map((u) => `${u.spec.name} #${u.index + 1}`).join(', ')}
          </p>
        )}
      </section>

      <footer className="mt-6 border-t border-line pt-2 text-[10px] leading-snug text-muted">{DISCLAIMER}</footer>
    </article>
  );
}

/**
 * Print-only copy of the report, mounted while the report dialog is open or the browser prints
 * (beforeprint), so Ctrl+P anywhere prints only the report.
 */
function PrintHost({ forceMount }: { forceMount: boolean }) {
  const plan = useDisplayPlan();
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  if (!printing && !forceMount) return null;
  return createPortal(
    <div className="print-only" aria-hidden>
      <ReportView plan={plan} />
    </div>,
    document.body,
  );
}

/** Report preview dialog with a Print button; also hosts the print-only report. */
export function ReportDialog() {
  const open = useStore((s) => !!s.ui.dialogs.report);
  const closeDialog = useStore((s) => s.closeDialog);
  const plan = useDisplayPlan();
  return (
    <>
      <PrintHost forceMount={open} />
      <Modal
        open={open}
        onClose={() => closeDialog('report')}
        title="Load plan report"
        icon={<Printer />}
        width="max-w-[820px]"
        footer={
          <>
            <Button variant="ghost" onClick={() => closeDialog('report')}>
              Close
            </Button>
            <Button variant="primary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
              Print / save as PDF
            </Button>
          </>
        }
      >
        {open && (
          <div className="rounded-lg border border-line p-5 shadow-inner">
            <ReportView plan={plan} />
          </div>
        )}
      </Modal>
    </>
  );
}
