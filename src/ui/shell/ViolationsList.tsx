import { CircleAlert, Info, ListChecks, OctagonAlert, PackageOpen, TriangleAlert, Wand2 } from 'lucide-react';
import type { Severity, Violation } from '../../domain/types';
import { useEvaluation } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Button } from '../common/Button';
import { Chip } from '../common/Chip';
import { scrollToItemTable } from './navigation';
import { Section } from './Section';
import { SEVERITY_LABEL, SEVERITY_ORDER, stageShort } from './shellFormat';

const ICON: Record<Severity, typeof Info> = { error: OctagonAlert, warning: TriangleAlert, info: Info };
const TONE: Record<Severity, string> = { error: 'text-bad', warning: 'text-warn', info: 'text-info' };

function ViolationRow({ v }: { v: Violation }) {
  const select = useStore((s) => s.select);
  const requestFocus = useStore((s) => s.requestFocus);
  const applyFix = useStore((s) => s.applyFix);
  const toast = useStore((s) => s.toast);
  const Icon = ICON[v.severity];
  const focusable = v.unitIds.length > 0;
  return (
    <li className="group flex items-start gap-2 rounded-lg px-1.5 py-1.5 -mx-1.5 hover:bg-black/[0.03]">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE[v.severity]}`} aria-hidden />
      <button
        type="button"
        disabled={!focusable}
        onClick={() => {
          select(v.unitIds);
          requestFocus(v.unitIds[0]);
        }}
        className="min-w-0 flex-1 rounded text-left text-xs leading-snug text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default"
        title={focusable ? 'Select and focus the units involved' : undefined}
      >
        {v.message}
        {v.stage !== undefined && (
          <Chip tone={v.stage === 0 ? 'neutral' : 'info'} className="ml-1.5 align-[1px]">
            {stageShort(v.stage)}
          </Chip>
        )}
      </button>
      {v.fix && (
        <Button
          size="sm"
          variant="secondary"
          className="!h-7 !px-2"
          icon={<Wand2 className="h-3.5 w-3.5" />}
          title={v.fix.label}
          onClick={() => {
            const fix = v.fix!;
            applyFix(fix.action);
            toast(`Applied: ${fix.label}`, 'success');
          }}
        >
          Fix
        </Button>
      )}
    </li>
  );
}

/** Violations of the active vehicle grouped by severity, with one-click fixes and camera focus. */
export function ViolationsList({ vehicleId }: { vehicleId: string }) {
  const evaluation = useEvaluation();
  const setTableTab = useStore((s) => s.setTableTab);
  const list = evaluation.byVehicle[vehicleId]?.violations ?? [];
  const elsewhere = evaluation.violations.length - list.length;
  const errors = list.filter((v) => v.severity === 'error').length;
  const warnings = list.filter((v) => v.severity === 'warning').length;
  const unplaced = evaluation.unplaced.length;

  return (
    <Section
      title="Checks"
      icon={<ListChecks />}
      right={
        list.length === 0 ? (
          <Chip tone="ok">All clear</Chip>
        ) : (
          <span className="flex gap-1">
            {errors > 0 && <Chip tone="bad">{errors} error{errors === 1 ? '' : 's'}</Chip>}
            {warnings > 0 && <Chip tone="warn">{warnings} warning{warnings === 1 ? '' : 's'}</Chip>}
          </span>
        )
      }
    >
      {list.length === 0 && <p className="text-xs text-muted">Every axle, weight, stacking, temperature, hazmat and unloading-order check passes at departure and after each stop.</p>}
      {SEVERITY_ORDER.map((sev) => {
        const items = list.filter((v) => v.severity === sev);
        if (!items.length) return null;
        return (
          <div key={sev} className="mb-2 last:mb-0">
            <h4 className={`mb-0.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide ${TONE[sev]}`}>
              {SEVERITY_LABEL[sev]} <span className="num text-muted">{items.length}</span>
            </h4>
            <ul>
              {items.map((v) => (
                <ViolationRow key={v.id} v={v} />
              ))}
            </ul>
          </div>
        );
      })}
      {unplaced > 0 && (
        <button
          type="button"
          onClick={() => {
            setTableTab('unplaced');
            scrollToItemTable();
          }}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-line-strong px-2.5 py-2 text-left text-xs text-ink-soft hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-accent"
        >
          <PackageOpen className="h-3.5 w-3.5 text-muted" aria-hidden />
          <span className="flex-1">
            {unplaced} unit{unplaced === 1 ? '' : 's'} not on any vehicle
          </span>
          <span className="text-muted">Show</span>
        </button>
      )}
      {elsewhere > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
          <CircleAlert className="h-3.5 w-3.5" aria-hidden /> {elsewhere} more on other vehicles
        </p>
      )}
    </Section>
  );
}
