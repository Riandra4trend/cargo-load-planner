import { Route } from 'lucide-react';
import { formatMass, formatPercent } from '../../domain/units';
import { useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { AxleStatusChip } from '../common/Chip';
import { Section } from './Section';
import { STATUS_SOFT } from './shellFormat';
import type { ShownState } from './useShownState';

/** Stop-by-stop axle utilisation: one row per stage, one column per axle group (% of limit). */
export function StageTable({ shown }: { shown: ShownState }) {
  const sys = useUnitSystem();
  const setAnimation = useStore((s) => s.setAnimation);
  const ve = shown.vehicleEval;
  const groups = ve.stages[0].axle.axles;
  const worst = ve.stages.reduce((w, st) => (rank(st.axle.status) > rank(w) ? st.axle.status : w), ve.stages[0].axle.status);
  return (
    <Section title="Stop by stop" icon={<Route />} right={<AxleStatusChip status={worst} />}>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-0.5 text-xs">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-muted">
              <th scope="col" className="py-1 pr-2 font-semibold">
                Stage
              </th>
              {groups.map((g) => (
                <th key={g.id} scope="col" className="px-1 py-1 text-right font-semibold" title={g.label}>
                  {g.label.replace(/ (axle|tandem|tridem|group)$/i, '')}
                </th>
              ))}
              <th scope="col" className="py-1 pl-2 text-right font-semibold">
                Cargo
              </th>
            </tr>
          </thead>
          <tbody>
            {ve.stages.map((st, i) => {
              const current = shown.stage === st.stage;
              return (
                <tr
                  key={st.stage}
                  className={`cursor-pointer ${current ? 'outline outline-2 -outline-offset-1 outline-accent/60 rounded' : ''}`}
                  onClick={() => setAnimation({ mode: 'unload', vehicleId: ve.vehicle.id, step: i, playing: false })}
                  title={`Show the load ${st.stage === 0 ? 'at departure' : `after stop ${st.stage}`}`}
                >
                  <th scope="row" className="py-1 pr-2 text-left font-medium text-ink-soft">
                    {st.label}
                  </th>
                  {st.axle.axles.map((a) => (
                    <td key={a.id} className="px-0.5 py-0.5 text-right">
                      <span
                        className={`num inline-block min-w-12 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${STATUS_SOFT[a.status]}`}
                        title={`${a.label}: ${formatPercent(a.ratio)} of the limit${a.status === 'under' ? ' (below minimum share)' : ''}`}
                      >
                        {formatPercent(a.ratio)}
                      </span>
                    </td>
                  ))}
                  <td className="num py-1 pl-2 text-right font-mono text-[11px] text-ink-soft">{formatMass(st.axle.cargoKg, sys)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">% of each group's limit after every delivery. Click a row to step through the unload.</p>
    </Section>
  );
}

function rank(s: 'legal' | 'near' | 'over' | 'under'): number {
  return { legal: 0, near: 1, under: 2, over: 3 }[s];
}
