import { Viewport } from './scene/Viewport';
import { useStore } from './state/store';
import { Toasts } from './ui/common/Toasts';
import { DataDialogs } from './ui/data/DataDialogs';
import { ItemTable } from './ui/data/ItemTable';
import { IoDialogs } from './ui/io/IoDialogs';
import { KpiCards } from './ui/shell/KpiCards';
import { PlanView } from './ui/shell/PlanView';
import { RightPanel } from './ui/shell/RightPanel';
import { ShellDialogs } from './ui/shell/ShellDialogs';
import { Sidebar } from './ui/shell/Sidebar';
import { TopBar } from './ui/shell/TopBar';

export function App() {
  const view = useStore((s) => s.ui.view);
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <section className="flex h-[60vh] min-h-[460px] gap-3">
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-card border border-line bg-card shadow-card">{view === 'plan' ? <PlanView /> : <Viewport />}</div>
            <RightPanel />
          </section>
          <KpiCards />
          <ItemTable />
        </main>
      </div>
      <ShellDialogs />
      <DataDialogs />
      <IoDialogs />
      <Toasts />
    </div>
  );
}
