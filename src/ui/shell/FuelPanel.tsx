import { Fuel, Pencil, Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { UnitSystem } from '../../domain/types';
import { formatConsumption, formatLitres, formatMass, formatMoney, formatNumber, formatPercent, KM_PER_MI, L_PER_US_GAL, lPer100kmToMpg } from '../../domain/units';
import type { FuelEstimate } from '../../physics/fuel';
import { useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Chip } from '../common/Chip';
import { Section } from './Section';
import type { ShownState } from './useShownState';

function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' }) {
  return (
    <div className="rounded-lg bg-canvas px-2.5 py-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`num font-mono text-[13px] font-semibold ${tone === 'bad' ? 'text-bad' : 'text-ink'}`}>{value}</p>
      {sub && <p className="num truncate text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

const SPLIT = [
  { key: 'drivingL', label: 'Driving', className: 'bg-accent' },
  { key: 'reeferL', label: 'Reefer', className: 'bg-info' },
  { key: 'idleL', label: 'Idling', className: 'bg-ink-soft' },
] as const;

const KG_PER_SHORT_TON = 907.18474;

/** Freight efficiency: metric "3.12 L per 100 t·km", imperial "512 ton-mi/gal" (US short tons). */
function freightEfficiency(f: FuelEstimate, sys: UnitSystem): string {
  if (sys === 'metric') return `${formatNumber(f.lPer100Tkm, 2)} L per 100 t·km`;
  const tonMiles = (f.tonneKm * (1000 / KG_PER_SHORT_TON)) / KM_PER_MI;
  return `${formatNumber(tonMiles / (f.drivingL / L_PER_US_GAL), 0)} ton-mi/gal`;
}

/**
 * Fuel estimate for the active vehicle's route: totals, cost, CO2, tank use, the driving/reefer/idling
 * split and every leg with the cargo still aboard. The leg driven next is highlighted during the unload view.
 */
export function FuelPanel({ shown }: { shown: ShownState }) {
  const sys = useUnitSystem();
  const currency = useStore((s) => s.plan.settings.currency);
  const openDialog = useStore((s) => s.openDialog);
  const ve = shown.vehicleEval;
  const v = ve.vehicle;
  const f = ve.fuel;
  const next = shown.stage === null ? null : `${shown.stage === 0 ? 'Depot' : shown.stage} →`;

  const actions = (
    <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
      <button type="button" className="inline-flex items-center gap-1 text-ink-soft hover:text-ink" onClick={() => openDialog('vehicleEditor', { mode: 'edit', vehicleId: v.id })}>
        <Pencil className="h-3 w-3" /> Vehicle consumption
      </button>
      <button type="button" className="inline-flex items-center gap-1 text-ink-soft hover:text-ink" onClick={() => openDialog('settings', true)}>
        <Settings2 className="h-3 w-3" /> Price, CO₂ and timing
      </button>
    </div>
  );

  let body: ReactNode;
  if (!f.legs.length) {
    body = <p className="text-xs text-muted">No cargo aboard, so this vehicle stays at the depot.</p>;
  } else if (f.km <= 0) {
    body = <p className="text-xs text-muted">Add the distance of each leg (edit a stop in the sidebar) to estimate fuel for this route.</p>;
  } else {
    const parts = SPLIT.filter((p) => f[p.key] > 0.005);
    body = (
      <>
        <div className="grid grid-cols-2 gap-1.5">
          <Tile label="Fuel" value={formatLitres(f.totalL, sys)} sub={formatMoney(f.cost, currency)} />
          <Tile label="Average" value={formatConsumption(f.avgLPer100km, sys)} sub={f.tonneKm > 0 ? freightEfficiency(f, sys) : undefined} />
          <Tile label="CO₂" value={formatMass(f.co2Kg, sys)} sub={`${formatNumber(f.hours, 1)} h on the road`} />
          <Tile
            label="Tank"
            value={formatPercent(f.tankShare)}
            sub={f.tankShare > 1 ? 'refuel on the way' : `of ${formatLitres(v.fuel.tankL, sys, 0)}`}
            tone={f.tankShare > 1 ? 'bad' : undefined}
          />
        </div>

        <div className="mt-3">
          <div className="flex h-2 overflow-hidden rounded-full bg-line" aria-hidden>
            {parts.map((p) => (
              <span key={p.key} className={p.className} style={{ width: `${(f[p.key] / f.totalL) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-soft">
            {parts.map((p) => (
              <li key={p.key} className="inline-flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${p.className}`} aria-hidden />
                {p.label} <span className="num font-mono text-[10.5px] text-ink">{formatLitres(f[p.key], sys)}</span>
              </li>
            ))}
          </ul>
        </div>

        <table className="mt-3 w-full text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
              <th className="py-1 pr-1 font-semibold">Leg</th>
              <th className="px-1 py-1 text-right font-semibold">{sys === 'metric' ? 'km' : 'mi'}</th>
              <th className="px-1 py-1 text-right font-semibold">Load</th>
              <th className="px-1 py-1 text-right font-semibold">{sys === 'metric' ? 'L/100' : 'mpg'}</th>
              <th className="py-1 pl-1 text-right font-semibold">Fuel</th>
            </tr>
          </thead>
          <tbody>
            {f.legs.map((leg) => (
              <tr key={leg.label} className={`border-t border-line/70 ${next && leg.label.startsWith(next) ? 'bg-accent-soft/70' : ''}`}>
                <td className="whitespace-nowrap py-1 pr-1 text-ink">
                  {leg.label}
                  {leg.cold && (
                    <Chip tone="info" className="ml-1 !px-1 !py-0 !text-[9px]" title="Reefer running">
                      Reefer
                    </Chip>
                  )}
                </td>
                <td className="num px-1 py-1 text-right font-mono text-[10.5px]">{formatNumber(sys === 'metric' ? leg.km : leg.km / KM_PER_MI, 0)}</td>
                <td className="num px-1 py-1 text-right font-mono text-[10.5px]">{formatMass(leg.cargoKg, sys)}</td>
                <td className="num px-1 py-1 text-right font-mono text-[10.5px]">{formatNumber(sys === 'metric' ? leg.lPer100km : lPer100kmToMpg(leg.lPer100km), 1)}</td>
                <td className="num py-1 pl-1 text-right font-mono text-[10.5px]">{formatLitres(leg.litres, sys)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[11px] text-muted">
          {formatConsumption(v.fuel.emptyLPer100km, sys)} empty → {formatConsumption(v.fuel.fullLPer100km, sys)} at full payload; each leg uses the cargo still aboard.
        </p>
      </>
    );
  }

  return (
    <Section title="Fuel & emissions" icon={<Fuel />} right={<Chip>Estimate</Chip>}>
      {body}
      {actions}
    </Section>
  );
}
