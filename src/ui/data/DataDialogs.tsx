import { useStore } from '../../state/store';
import { ItemEditor } from './ItemEditor';
import { UrgentOrderDialog } from './UrgentOrderDialog';

/** Item editor and urgent-order dialog, driven by ui.dialogs. */
export function DataDialogs() {
  const itemEditor = useStore((s) => s.ui.dialogs.itemEditor);
  const urgent = useStore((s) => s.ui.dialogs.urgent);
  return (
    <>
      {itemEditor && <ItemEditor key={`${itemEditor.mode}:${itemEditor.lineId ?? ''}:${itemEditor.templateId ?? ''}:${itemEditor.stopId ?? ''}`} request={itemEditor} />}
      {urgent && <UrgentOrderDialog />}
    </>
  );
}
