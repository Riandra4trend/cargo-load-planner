import { useEffect, useRef } from 'react';
import { formatDims } from '../../domain/units';
import { useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { AxlePanel } from './AxlePanel';
import { CogPanel } from './CogPanel';
import { FuelPanel } from './FuelPanel';
import { LoadDistributionChart } from './LoadDistributionChart';
import { SimulationPanel } from './SimulationPanel';
import { StageTable } from './StageTable';
import { useShownState } from './useShownState';
import { ViolationsList } from './ViolationsList';

/** Physics panel of the active vehicle: simulation controls, axle loads, stages, load distribution, COG and checks. */
export function RightPanel() {
  const shown = useShownState();
  const sys = useUnitSystem();
  const mode = useStore((s) => s.ui.animation.mode);
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = shown.vehicleEval.vehicle;
  useEffect(() => {
    if (mode !== 'idle') scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [mode]);
  return (
    <aside aria-label={`Load checks for ${v.name}`} className="flex w-full shrink-0 flex-col overflow-hidden rounded-card border border-line bg-card shadow-card xl:w-[340px]">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-xs text-muted">
          <span className="font-semibold text-ink">{v.name}</span> · <span className="num">{formatDims(v.cargo, sys, { big: true })}</span>
        </p>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-2 md:content-start xl:block">
        <SimulationPanel />
        <AxlePanel shown={shown} />
        <StageTable shown={shown} />
        <FuelPanel shown={shown} />
        <LoadDistributionChart shown={shown} />
        <CogPanel shown={shown} />
        <ViolationsList vehicleId={v.id} />
      </div>
    </aside>
  );
}
