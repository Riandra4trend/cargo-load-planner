import { OptimiseDialog } from './OptimiseDialog';
import { ReportDialog } from './ReportView';
import { SettingsDialog } from './SettingsDialog';
import { useShortcuts } from './useShortcuts';

/** Shell-owned dialogs (optimise progress/diff, settings, report) and the global keyboard shortcuts. */
export function ShellDialogs() {
  useShortcuts();
  return (
    <>
      <OptimiseDialog />
      <SettingsDialog />
      <ReportDialog />
    </>
  );
}
