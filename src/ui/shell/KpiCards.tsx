import { Boxes, ClipboardCheck, Fuel, Gauge, LayoutGrid, Ruler, Weight } from 'lucide-react';
import type { ReactNode } from 'react';
import { bigLengthUnit, formatConsumption, formatLength, formatMass, formatMoney, formatNumber, formatPercent, fromMetres, litreParts, massParts } from '../../domain/units';
import { useActiveVehicleEval, useEvaluation, useUnitSystem } from '../../state/hooks';
import { Card } from '../common/Card';
import { lowerFirst } from './shellFormat';

function Kpi({ icon, label, value, unit, sub, tone = 'neutral' }: { icon: ReactNode; label: string; value: string; unit?: string; sub: ReactNode; tone?: 'neutral' | 'bad' | 'ok' }) {
  return (
    <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <p className="num truncate text-[22px] font-semibold leading-tight text-ink">
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-muted">{unit}</span>}
      </p>
      <p className={`truncate text-xs ${tone === 'bad' ? 'font-medium text-bad' : tone === 'ok' ? 'text-ok' : 'text-ink-soft'}`}>{sub}</p>
    </Card>
  );
}

/** Seven live KPIs for the active vehicle (orders across the plan). */
export function KpiCards() {
  const sys = useUnitSystem();
  const evaluation = useEvaluation();
  const ve = useActiveVehicleEval();
  const v = ve.vehicle;
  const multi = evaluation.plan.vehicles.length > 1;
  const cargoKg = ve.axle.cargoKg;
  const [cargoValue, cargoUnit] = massParts(cargoKg, sys);
  const [remValue, remUnit] = massParts(ve.remaining.kg, sys);
  const broken = ve.violations.filter((x) => x.severity === 'error').length;
  const occupied = ve.bays.filter((b) => b.kg > 0.5);
  const fullest = ve.bays.reduce((best, b) => (b.fill > best.fill ? b : best), ve.bays[0]);
  const lenUnit = bigLengthUnit(sys);
  const unplaced = evaluation.unplaced.length;
  const fuel = ve.fuel;
  const [fuelValue, fuelUnit] = litreParts(fuel.totalL, sys);
  const currency = evaluation.plan.settings.currency;

  return (
    <section aria-label={`Key figures${multi ? ` for ${v.name}` : ''}`} className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
      <Kpi icon={<Weight />} label="Total cargo weight" value={cargoValue} unit={cargoUnit} sub={`${formatPercent(ve.fill.weight)} of the ${formatMass(v.payloadKg, sys)} payload`} />
      <Kpi
        icon={<Gauge />}
        label="Remaining capacity"
        value={remValue}
        unit={remUnit}
        tone={broken > 0 ? 'bad' : 'neutral'}
        sub={broken > 0 ? `${broken} rule${broken === 1 ? '' : 's'} broken` : `the ${lowerFirst(ve.remaining.limitedBy)} limits it here`}
      />
      <Kpi
        icon={<Boxes />}
        label="Fill volume & weight"
        value={`${formatPercent(ve.fill.volume)} · ${formatPercent(ve.fill.weight)}`}
        sub={`${ve.fill.units} unit${ve.fill.units === 1 ? '' : 's'} in ${formatLength(ve.fill.usedLength, sys, { big: true, digits: 1 })}`}
      />
      <Kpi
        icon={<Ruler />}
        label="Loading metres"
        value={formatNumber(fromMetres(ve.fill.ldm, lenUnit), 1)}
        unit={sys === 'metric' ? 'ldm' : 'ft'}
        sub={`of ${formatLength(v.cargo.l, sys, { big: true, digits: 1 })} floor · ${formatPercent(ve.fill.ldm / v.cargo.l)}`}
      />
      <Kpi
        icon={<LayoutGrid />}
        label="Active load bays"
        value={`${occupied.length} / ${ve.bays.length}`}
        unit="bays"
        sub={occupied.length ? `fullest ${fullest.label} at ${formatPercent(fullest.fill)}` : 'no bays in use'}
      />
      <Kpi
        icon={<ClipboardCheck />}
        label="Orders loaded"
        value={`${evaluation.orders.loaded} of ${evaluation.orders.total}`}
        tone={unplaced > 0 ? 'bad' : evaluation.orders.total > 0 ? 'ok' : 'neutral'}
        sub={unplaced > 0 ? `${unplaced} unit${unplaced === 1 ? '' : 's'} not loaded` : evaluation.orders.total > 0 ? 'every unit is on a vehicle' : 'no orders yet'}
      />
      <Kpi
        icon={<Fuel />}
        label="Fuel (estimate)"
        value={fuel.km > 0 ? fuelValue : '-'}
        unit={fuel.km > 0 ? fuelUnit : undefined}
        sub={
          fuel.km > 0
            ? `${formatConsumption(fuel.avgLPer100km, sys)} · ${formatMoney(fuel.cost, currency)}${multi ? ` · plan ${formatMoney(evaluation.fuel.cost, currency)}` : ''}`
            : fuel.legs.length
              ? 'add stop distances'
              : 'no cargo on this vehicle'
        }
      />
    </section>
  );
}
