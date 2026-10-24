import { useStore } from '../../state/store';
import { CsvImportDialog } from './CsvImportDialog';
import { PlansDialog } from './PlansDialog';
import { ShareDialog } from './ShareDialog';
import { VehicleEditor } from './VehicleEditor';

/** IO dialogs: CSV import, plans manager, share link and vehicle editor. Each mounts fresh when opened. */
export function IoDialogs() {
  const dialogs = useStore((s) => s.ui.dialogs);
  return (
    <>
      {dialogs.import && <CsvImportDialog />}
      {dialogs.plans && <PlansDialog />}
      {dialogs.share && <ShareDialog />}
      {dialogs.vehicleEditor && <VehicleEditor key={`${dialogs.vehicleEditor.mode}:${dialogs.vehicleEditor.vehicleId ?? ''}`} request={dialogs.vehicleEditor} />}
    </>
  );
}
