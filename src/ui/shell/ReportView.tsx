import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { TEMP_LABELS } from '../../domain/colors';
import { DISCLAIMER } from '../../domain/settings';
import type { Plan, Vehicle } from '../../domain/types';
import { formatDims, formatLength, formatMass, formatNumber, formatPercent, formatWeight } from '../../domain/units';
import { loadingSequence } from '../../sim/sequence';
import { evaluatePlan, type VehicleEval } from '../../state/evaluate';
import { useDisplayPlan } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Button } from '../common/Button';
import { AxleStatusChip } from '../common/Chip';
import { Modal } from '../common/Modal';
import { PlanDiagram, PlanLegend } from './PlanDiagram';
import { formatPlanDate, lowerFirst, SEVERITY_LABEL, SEVERITY_ORDER, STATUS_TEXT, stageShort, weightPair } from './shellFormat';

const DIAGRAM_WIDTH = 700;
const KM_PER_MI = 1.609344;

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
          {formatDims(v.cargo, sys, { big: true })} · payload {formatMass(v.payloadKg, sys)} · GVW/GCW {formatMass(v.grossLimitKg, sys)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-3 text-[11.5px]">
        <MetaItem label="Cargo weight" value={`${formatMass(ve.axle.cargoKg, sys)} (${formatPercent(ve.fill.weight)} of payload)`} />
        <MetaItem label="Units · volume" value={`${ve.fill.units} units · ${formatPercent(ve.fill.volume)}`} />
        <MetaItem label="Remaining capacity" value={ve.remaining.kg > 0 ? `${formatMass(ve.remaining.kg, sys)} (${lowerFirst(ve.remaining.limitedBy)})` : `none: ${lowerFirst(ve.remaining.limitedBy)}`} />
        <MetaItem label="Cargo COG" value={ve.axle.cog ? `${formatLength(ve.axle.cog.x, sys, { big: true })} from front, ${formatLength(ve.axle.cog.z, sys, { big: true })} high` : 'empty'} />
      </div>

      <div className="report-diagrams">
        <H>Floor plan (top view)</H>
        <PlanDiagram plan={plan} vehicleId={v.id} mode="top" width={DIAGRAM_WIDTH} />
        <H>Side elevation</H>
        <PlanDiagram plan={plan} vehicleId={v.id} mode="side" width={DIAGRAM_WIDTH} />
        <div className="mt-2">
          <PlanLegend plan={plan} vehicleId={v.id} />
        </div>
      </div>

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
        <MetaItem label="Distance" value={m.distanceKm > 0 ? (sys === 'metric' ? `${formatNumber(m.distanceKm, 0)} km` : `${formatNumber(m.distanceKm / KM_PER_MI, 0)} mi`) : ''} />
        <MetaItem label="Driver" value={m.driver} />
        <MetaItem label="Vehicles" value={plan.vehicles.map((v) => v.name).join(', ')} />
        <MetaItem label="Total cargo" value={`${formatMass(evaluation.totalKg, sys)} · ${evaluation.units.length} units`} />
        <MetaItem label="Orders loaded" value={`${evaluation.orders.loaded} of ${evaluation.orders.total}`} />
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
              <th className="px-1.5 py-1">Dimensions</th>
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
              const where = [...new Set(placed.map((u) => `T${vehicleIndex.get(plan.placements[u.id].vehicleId)}`))].join(', ');
              const handling = [
                l.spec.temp !== 'ambient' ? TEMP_LABELS[l.spec.temp] : '',
                l.spec.hazmat ? `${l.spec.hazmat.unNumber} cl. ${l.spec.hazmat.hazClass}` : '',
                l.spec.fragile ? 'fragile' : '',
                l.spec.stackable ? `stack ≤ ${l.spec.maxStackLayers}` : 'no stack',
                l.priority === 'urgent' ? 'urgent' : '',
              ].filter(Boolean);
              return (
                <tr key={l.id} className="border-t border-line align-top">
                  <td className="py-1 pr-1.5">
                    <span className="num font-semibold">{stop?.sequence ?? '–'}</span> {stop ? customers.get(stop.customerId) : ''}
                  </td>
                  <td className="px-1.5 py-1">{l.spec.name}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 font-mono">{l.spec.sku}</td>
                  <td className="num px-1.5 py-1 text-right">{l.quantity}</td>
                  <td className="num whitespace-nowrap px-1.5 py-1">{formatDims(l.spec.dims, sys)}</td>
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
