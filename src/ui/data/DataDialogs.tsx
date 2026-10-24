import { useStore } from '../../state/store';
import { ItemEditor } from './ItemEditor';
import { LiquidWeightsDialog } from './LiquidWeightsDialog';
import { UrgentOrderDialog } from './UrgentOrderDialog';

/** Item editor, urgent-order dialog and the liquid weight reference, driven by ui.dialogs. */
export function DataDialogs() {
  const itemEditor = useStore((s) => s.ui.dialogs.itemEditor);
  const urgent = useStore((s) => s.ui.dialogs.urgent);
  const liquids = useStore((s) => s.ui.dialogs.liquids);
  return (
    <>
      {itemEditor && <ItemEditor key={`${itemEditor.mode}:${itemEditor.lineId ?? ''}:${itemEditor.templateId ?? ''}:${itemEditor.stopId ?? ''}`} request={itemEditor} />}
      {urgent && <UrgentOrderDialog />}
      {liquids && <LiquidWeightsDialog />}
    </>
  );
}
