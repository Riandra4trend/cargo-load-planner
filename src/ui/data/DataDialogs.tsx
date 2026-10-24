import { useStore } from '../../state/store';
import { ItemEditor } from './ItemEditor';
import { MaterialWeightsDialog } from './MaterialWeightsDialog';
import { UrgentOrderDialog } from './UrgentOrderDialog';

/** Item editor, urgent-order dialog and the material weight reference, driven by ui.dialogs. */
export function DataDialogs() {
  const itemEditor = useStore((s) => s.ui.dialogs.itemEditor);
  const urgent = useStore((s) => s.ui.dialogs.urgent);
  const materials = useStore((s) => s.ui.dialogs.materials);
  return (
    <>
      {itemEditor && <ItemEditor key={`${itemEditor.mode}:${itemEditor.lineId ?? ''}:${itemEditor.templateId ?? ''}:${itemEditor.stopId ?? ''}`} request={itemEditor} />}
      {urgent && <UrgentOrderDialog />}
      {materials && <MaterialWeightsDialog />}
    </>
  );
}
