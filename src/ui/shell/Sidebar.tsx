import { ClipboardList, LayoutDashboard, Route, Warehouse } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { DISCLAIMER } from '../../domain/settings';
import { formatDistance, formatMass, formatPercent } from '../../domain/units';
import { routeKm } from '../../physics/fuel';
import { useEvaluation, useUnitSystem } from '../../state/hooks';
import { useStore, type NavPanel } from '../../state/store';
import { scrollToItemTable, useLoadSimulation } from './navigation';
import { HEALTH_DOT, vehicleHealth } from './shellFormat';
import { StopList } from './StopList';
import { VehicleList } from './VehicleList';

const NAV: { id: NavPanel; label: string; icon: ReactNode }[] = [
  { id: 'loadplan', label: 'Load plan', icon: <LayoutDashboard /> },
  { id: 'orders', label: 'Orders', icon: <ClipboardList /> },
  { id: 'dock', label: 'Dock', icon: <Warehouse /> },
  { id: 'route', label: 'Route', icon: <Route /> },
];

function Heading({ children, right, id }: { children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="mb-1.5 mt-4 flex items-center px-1">
      <h2 id={id} tabIndex={-1} className="flex-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted outline-none focus-visible:text-ink">
        {children}
      </h2>
      {right}
    </div>
  );
}

/** Left sidebar: navigation, vehicles, stops/customer legend, per-vehicle summary and disclaimer. */
export function Sidebar() {
  const sys = useUnitSystem();
  const evaluation = useEvaluation();
  const nav = useStore((s) => s.ui.nav);
  const setNav = useStore((s) => s.setNav);
  const setAnimation = useStore((s) => s.setAnimation);
  const startLoad = useLoadSimulation();
  const stopsRef = useRef<HTMLDivElement>(null);
  const plan = evaluation.plan;
  const distanceKm = routeKm(plan);

  const go = (id: NavPanel) => {
    setNav(id);
    if (id === 'loadplan') {
      setAnimation({ mode: 'idle', playing: false, step: 0 });
      document.getElementById('workspace')?.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (id === 'orders') scrollToItemTable();
    else if (id === 'dock') startLoad();
    else {
      stopsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      document.getElementById('sidebar-stops')?.focus();
    }
  };

  return (
    <aside aria-label="Plan navigation" className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-card px-3 pb-3 pt-3 print:hidden">
      <nav aria-label="Sections">
        <ul className="space-y-0.5">
          {NAV.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                aria-current={nav === n.id ? 'page' : undefined}
                onClick={() => go(n.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent [&>svg]:h-4 [&>svg]:w-4 ${
                  nav === n.id ? 'bg-ink text-white' : 'text-ink-soft hover:bg-black/5'
                }`}
              >
                {n.icon}
                {n.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <Heading>Vehicles</Heading>
      <VehicleList />

      <div ref={stopsRef}>
        <Heading
          id="sidebar-stops"
          right={
            distanceKm > 0 ? (
              <span className="num text-[11px] text-muted" title={plan.meta.returnKm > 0 ? `Includes ${formatDistance(plan.meta.returnKm, sys)} back to the depot` : undefined}>
                {formatDistance(distanceKm, sys)}
              </span>
            ) : undefined
          }
        >
          Stops · route order
        </Heading>
        <StopList />
      </div>

      <div className="mt-auto pt-4">
        <Heading>Summary</Heading>
        <ul className="space-y-1.5 px-1">
          {evaluation.plan.vehicles.map((v) => {
            const ve = evaluation.byVehicle[v.id];
            return (
              <li key={v.id} className="text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${HEALTH_DOT[vehicleHealth(ve)]}`} aria-hidden />
                  <span className="flex-1 truncate font-medium text-ink-soft">{v.name}</span>
                </div>
                <p className="num pl-3 text-muted">
                  {ve.fill.units} units · {formatMass(ve.axle.cargoKg, sys)} · {formatPercent(ve.fill.volume)} vol
                </p>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 px-1 text-[10.5px] leading-snug text-muted">{DISCLAIMER}</p>
      </div>
    </aside>
  );
}
