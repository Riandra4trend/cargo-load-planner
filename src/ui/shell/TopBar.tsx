import {
  CalendarClock,
  Container,
  Mountain,
  Scale,
  Droplets,
  Download,
  FileJson,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Forklift,
  Link2,
  Loader2,
  PanelLeft,
  PackagePlus,
  Printer,
  Redo2,
  Route,
  Settings,
  Siren,
  Sparkles,
  Undo2,
  Upload,
  Warehouse,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { createEmptyPlan } from '../../data/emptyPlan';
import { createSeedPlan, createTankerSeedPlan, createTipperSeedPlan } from '../../data/seed';
import type { UnitSystem } from '../../domain/types';
import { downloadItemsCsv } from '../../io/csv';
import { downloadPlanJson, readPlanFile } from '../../io/planFile';
import { useStore, type ViewMode } from '../../state/store';
import { Button, IconButton } from '../common/Button';
import { SegmentedControl } from '../common/fields';
import { Menu, type MenuEntry } from './Menu';
import { useLoadSimulation } from './navigation';
import { formatPlanDate } from './shellFormat';

const VIEWS: { value: ViewMode; label: string; title: string }[] = [
  { value: '3d', label: '3D', title: '3D view (1)' },
  { value: 'side', label: 'Side', title: 'Side view (2)' },
  { value: 'top', label: 'Top', title: 'Top view (3)' },
  { value: 'plan', label: 'Plan', title: '2D dimensioned plan (4)' },
];

function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--color-ink)" />
      <path d="M8 19.5 16 15l8 4.5L16 24z" fill="var(--color-accent)" />
      <path d="M8 19.5V12l8-4.5V15z" fill="#fff" fillOpacity="0.9" />
      <path d="M24 19.5V12l-8-4.5V15z" fill="#fff" fillOpacity="0.55" />
    </svg>
  );
}

function PlanName() {
  const name = useStore((s) => s.plan.name);
  const renamePlan = useStore((s) => s.renamePlan);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const next = draft?.trim();
    if (next && next !== name) renamePlan(next);
    setDraft(null);
  };
  return (
    <input
      aria-label="Plan name"
      value={draft ?? name}
      onFocus={() => setDraft(name)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className="h-8 w-full min-w-0 max-w-[260px] truncate rounded-lg border border-transparent bg-transparent px-2 text-sm font-medium text-ink-soft hover:border-line focus:border-accent focus:bg-card focus:outline-none focus:ring-2 focus:ring-accent/25"
    />
  );
}

function MetaChips() {
  const meta = useStore((s) => s.plan.meta);
  const stops = useStore((s) => s.plan.stops.length);
  const openDialog = useStore((s) => s.openDialog);
  const chip = 'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-accent';
  return (
    <div className="hidden items-center gap-0.5 lg:flex">
      <button type="button" className={chip} onClick={() => openDialog('settings', true)} title="Edit plan details">
        <CalendarClock className="h-3.5 w-3.5 text-muted" aria-hidden />
        <span className="num font-medium text-ink">{meta.time}</span>
        <span>{formatPlanDate(meta.date)}</span>
      </button>
      {meta.dock && (
        <button type="button" className={chip} onClick={() => openDialog('settings', true)} title="Edit plan details">
          <Warehouse className="h-3.5 w-3.5 text-muted" aria-hidden />
          {meta.dock}
        </button>
      )}
      <button type="button" className={chip} onClick={() => openDialog('settings', true)} title="Edit plan details">
        <Route className="h-3.5 w-3.5 text-muted" aria-hidden />
        {meta.route && <span className="font-medium text-ink">{meta.route}</span>}
        <span>
          {stops} stop{stops === 1 ? '' : 's'}
        </span>
      </button>
    </div>
  );
}

function OptimiseButton() {
  const optimise = useStore((s) => s.ui.optimise);
  const startOptimise = useStore((s) => s.startOptimise);
  const cancelOptimise = useStore((s) => s.cancelOptimise);
  if (optimise.running) {
    return (
      <div className="flex items-center gap-1" role="status" aria-live="polite">
        <Button variant="primary" disabled className="!opacity-90" icon={<Loader2 className="h-4 w-4 animate-spin" />}>
          <span className="num">Optimising {Math.round(optimise.progress * 100)} %</span>
        </Button>
        <IconButton label="Cancel optimisation" variant="secondary" onClick={cancelOptimise}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
    );
  }
  return (
    <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} onClick={() => startOptimise()} title="Pack the load automatically">
      Optimise
    </Button>
  );
}

function FileMenu() {
  const fileRef = useRef<HTMLInputElement>(null);
  const s = useStore.getState;
  const entries: MenuEntry[] = [
    { kind: 'heading', label: 'Plan' },
    { label: 'Sample: mixed freight (reefer)', icon: <Container />, onSelect: () => s().replacePlan(createSeedPlan(), { keepHistory: true }) },
    { label: 'Sample: fuel delivery (tanker)', icon: <Droplets />, onSelect: () => s().replacePlan(createTankerSeedPlan(), { keepHistory: true }) },
    { label: 'Sample: sand & gravel (dump trucks)', icon: <Mountain />, onSelect: () => s().replacePlan(createTipperSeedPlan(), { keepHistory: true }) },
    { label: 'New empty plan', icon: <FilePlus2 />, onSelect: () => s().replacePlan(createEmptyPlan(), { keepHistory: true }) },
    { label: 'Plans…', icon: <FolderOpen />, onSelect: () => s().openDialog('plans', true) },
    { kind: 'separator' },
    { kind: 'heading', label: 'Import & export' },
    { label: 'Import JSON…', icon: <Upload />, onSelect: () => fileRef.current?.click() },
    { label: 'Export JSON', icon: <FileJson />, onSelect: () => downloadPlanJson(s().plan) },
    { label: 'Import CSV…', icon: <FileSpreadsheet />, onSelect: () => s().openDialog('import', true) },
    { label: 'Export CSV', icon: <Download />, onSelect: () => downloadItemsCsv(s().plan) },
    { label: 'Share link…', icon: <Link2 />, onSelect: () => s().openDialog('share', true) },
    { kind: 'separator' },
    { label: 'Print report', icon: <Printer />, onSelect: () => s().openDialog('report', true) },
    { kind: 'separator' },
    { kind: 'heading', label: 'Reference & settings' },
    { label: 'Material weights…', icon: <Scale />, onSelect: () => s().openDialog('materials', true) },
    { label: 'Settings…', icon: <Settings />, onSelect: () => s().openDialog('settings', true) },
  ];
  return (
    <>
      <Menu
        label="File menu"
        align="right"
        entries={entries}
        triggerClassName="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-sm font-medium text-ink hover:bg-canvas"
        trigger={
          <>
            <FileText className="h-4 w-4" aria-hidden />
            <span className="hidden xl:inline">File</span>
          </>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const plan = await readPlanFile(file);
            s().replacePlan(plan, { keepHistory: true });
            s().toast(`Imported "${plan.name}"`, 'success');
          } catch (err) {
            s().toast(err instanceof Error ? err.message : 'Could not read the file', 'error');
          }
        }}
      />
    </>
  );
}

/** App header: brand, plan name and details, view switch, simulation/optimise actions, units, history, file menu. */
export function TopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const view = useStore((s) => s.ui.view);
  const setView = useStore((s) => s.setView);
  const units = useStore((s) => s.plan.settings.units);
  const updateSettings = useStore((s) => s.updateSettings);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const openDialog = useStore((s) => s.openDialog);
  const paletteOpen = useStore((s) => s.ui.paletteOpen);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const startLoadSimulation = useLoadSimulation();

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-card px-3 py-2 print:hidden">
      <IconButton label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} active={sidebarOpen} onClick={onToggleSidebar}>
        <PanelLeft className="h-4.5 w-4.5" />
      </IconButton>
      <div className="flex min-w-0 items-center gap-2">
        <LogoMark />
        <span className="hidden whitespace-nowrap text-[15px] font-semibold tracking-tight sm:inline">LoadPlanner 3D</span>
        <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
        <PlanName />
      </div>
      <MetaChips />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <SegmentedControl label="View" value={view} onChange={setView} options={VIEWS} />
        <Button
          icon={<PackagePlus className="h-4 w-4" />}
          aria-pressed={paletteOpen}
          onClick={() => setPaletteOpen(!paletteOpen)}
          title="Add cargo to the truck (A)"
          className={`!border-accent !text-accent-strong hover:!bg-accent-soft ${paletteOpen ? '!bg-accent-soft' : ''}`}
        >
          Add cargo
        </Button>
        <Button icon={<Siren className="h-4 w-4" />} onClick={() => openDialog('urgent', true)} title="Add an urgent order and re-optimise">
          <span className="hidden min-[1800px]:inline">Urgent order</span>
        </Button>
        <Button icon={<Forklift className="h-4 w-4" />} onClick={startLoadSimulation} title="Animate the forklift loading sequence at the dock">
          <span className="hidden min-[1800px]:inline">Load at dock</span>
        </Button>
        <OptimiseButton />
        <span className="hidden h-6 w-px bg-line md:block" aria-hidden />
        <SegmentedControl<UnitSystem>
          size="sm"
          label="Units"
          value={units}
          onChange={(u) => updateSettings({ units: u })}
          options={[
            { value: 'metric', label: 'kg · m', title: 'Metric units' },
            { value: 'imperial', label: 'lb · ft', title: 'Imperial units' },
          ]}
        />
        <div className="flex items-center">
          <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
            <Undo2 className="h-4 w-4" />
          </IconButton>
          <IconButton label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
            <Redo2 className="h-4 w-4" />
          </IconButton>
        </div>
        <FileMenu />
      </div>
    </header>
  );
}
