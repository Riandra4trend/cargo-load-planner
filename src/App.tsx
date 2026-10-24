import { useState } from 'react';
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
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1100);
  return (
    <div className="flex h-full flex-col">
      <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        <main id="workspace" className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <section className="flex shrink-0 flex-col gap-3 xl:h-[64vh] xl:min-h-[500px] xl:flex-row">
            <div className="relative h-[56vh] min-h-[380px] min-w-0 flex-1 overflow-hidden rounded-card border border-line bg-card shadow-card xl:h-auto">
              {view === 'plan' ? <PlanView /> : <Viewport />}
            </div>
            <div className="flex max-h-[80vh] xl:max-h-none">
              <RightPanel />
            </div>
          </section>
          <KpiCards />
          <div id="item-table" className="scroll-mt-3">
            <ItemTable />
          </div>
        </main>
      </div>
      <ShellDialogs />
      <DataDialogs />
      <IoDialogs />
      <Toasts />
    </div>
  );
}
