import { Printer } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { formatDims } from '../../domain/units';
import { useActiveVehicle, useDisplayPlan } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Button } from '../common/Button';
import { SegmentedControl } from '../common/fields';
import { PlanDiagram, PlanLegend } from './PlanDiagram';

/** Tracks the content width of an element. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** 2D dimensioned plan of the active vehicle: top-down floor plan and side elevation (printable). */
export function PlanView() {
  const plan = useDisplayPlan();
  const vehicle = useActiveVehicle();
  const selection = useStore((s) => s.ui.selection);
  const select = useStore((s) => s.select);
  const setActiveVehicle = useStore((s) => s.setActiveVehicle);
  const openDialog = useStore((s) => s.openDialog);
  const [ref, width] = useWidth<HTMLDivElement>();

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          Plan view <span className="ml-1 font-normal text-muted">{vehicle.name} · {formatDims(vehicle.cargo, plan.settings.units, { big: true })}</span>
        </h2>
        {plan.vehicles.length > 1 && (
          <SegmentedControl size="sm" label="Vehicle" value={vehicle.id} onChange={setActiveVehicle} options={plan.vehicles.map((v, i) => ({ value: v.id, label: `Truck ${i + 1}`, title: v.name }))} />
        )}
        <Button size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => openDialog('report', true)}>
          Print report
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3" onClick={(e) => e.target === e.currentTarget && select([])}>
        <div ref={ref} className="w-full">
          {width > 0 && (
            <>
              {(vehicle.tank ? (['side', 'top'] as const) : (['top', 'side'] as const)).map((mode, i) => (
                <div key={mode} className={i > 0 ? 'mt-4' : ''}>
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {mode === 'side' ? (vehicle.tank ? 'Tank compartments (side)' : 'Side elevation (left side)') : vehicle.tank ? 'Top view' : 'Floor plan (top)'}
                  </h3>
                  <PlanDiagram plan={plan} vehicleId={vehicle.id} mode={mode} width={width} selection={selection} onSelect={(ids) => select(ids)} />
                </div>
              ))}
              <div className="mt-3">
                <PlanLegend plan={plan} vehicleId={vehicle.id} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
