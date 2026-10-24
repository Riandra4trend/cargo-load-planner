import { Copy, Download, FilePlus2, FileSpreadsheet, FolderOpen, Pencil, Save, Sparkles, Trash2, Upload } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createEmptyPlan } from '../../data/emptyPlan';
import { createSeedPlan } from '../../data/seed';
import { VEHICLE_PRESETS } from '../../domain/presets';
import type { Id, Plan } from '../../domain/types';
import { downloadItemsCsv } from '../../io/csv';
import {
  deleteSavedPlan,
  duplicateSavedPlan,
  listSavedPlans,
  loadSavedPlan,
  overwriteSavedPlan,
  renameSavedPlan,
  savePlanAs,
  type SavedPlanInfo,
} from '../../io/persistence';
import { downloadPlanJson, readPlanFile } from '../../io/planFile';
import { useStore } from '../../state/store';
import { Button, IconButton } from '../common/Button';
import { Chip } from '../common/Chip';
import { Select, TextInput } from '../common/fields';
import { Modal } from '../common/Modal';

const formatUpdated = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Gives the working plan (and its undo history) a new identity after "Save as", so later saves overwrite that entry. */
function adoptIdentity(id: Id, name: string) {
  useStore.setState((s) => ({
    plan: { ...s.plan, id, name },
    past: s.past.map((p) => ({ ...p, id })),
    future: s.future.map((p) => ({ ...p, id })),
  }));
}

/** True when the working plan is not saved or differs from its saved copy. */
function hasUnsavedChanges(plan: Plan): boolean {
  const saved = loadSavedPlan(plan.id);
  return !saved || JSON.stringify(saved) !== JSON.stringify(plan);
}

interface PendingSwitch {
  /** What happens to the current plan, e.g. "Opening “Monday run”". */
  what: string;
  run: () => void;
}

/** Saved plans manager: save / save as, open, rename, duplicate, delete, new plans and JSON import/export. */
export function PlansDialog() {
  const plan = useStore((s) => s.plan);
  const closeDialog = useStore((s) => s.closeDialog);
  const replacePlan = useStore((s) => s.replacePlan);
  const renamePlan = useStore((s) => s.renamePlan);
  const toast = useStore((s) => s.toast);

  const [plans, setPlans] = useState<SavedPlanInfo[]>(() => listSavedPlans());
  const [saveAsName, setSaveAsName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: Id; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Id | null>(null);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState('eu-rigid-18');
  const jsonInput = useRef<HTMLInputElement>(null);
  const close = useCallback(() => closeDialog('plans'), [closeDialog]);

  const refresh = () => setPlans(listSavedPlans());
  const currentSaved = plans.some((p) => p.id === plan.id);

  /** Runs a storage operation; failures (e.g. full storage) are shown in the dialog. */
  const attempt = <T,>(op: () => T): T | undefined => {
    try {
      const result = op();
      setError(null);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  };

  const saveAs = (name: string): boolean => {
    const info = attempt(() => savePlanAs(plan, name));
    if (!info) return false;
    adoptIdentity(info.id, info.name);
    refresh();
    setSaveAsName(null);
    toast(`Saved as “${info.name}”`, 'success');
    return true;
  };

  const save = (): boolean => {
    if (!currentSaved) return saveAs(plan.name);
    const info = attempt(() => overwriteSavedPlan(plan.id, plan));
    if (!info) return false;
    refresh();
    toast(`Saved “${info.name}”`, 'success');
    return true;
  };

  /** Replaces the working plan, asking first when it has unsaved changes. */
  const switchTo = (what: string, run: () => void) => {
    if (hasUnsavedChanges(plan)) setPending({ what, run });
    else run();
  };

  const finishSwitch = (next: Plan, message: string) => {
    replacePlan(next);
    toast(message, 'success');
    close();
  };

  const open = (info: SavedPlanInfo) =>
    switchTo(`Opening “${info.name}”`, () => {
      const p = loadSavedPlan(info.id);
      if (!p) {
        setError(`“${info.name}” could not be read; the saved data is damaged.`);
        return;
      }
      finishSwitch(p, `Opened “${p.name}”`);
    });

  const commitRename = () => {
    if (!renaming) return;
    const info = attempt(() => renameSavedPlan(renaming.id, renaming.name));
    if (info && info.id === plan.id) renamePlan(info.name);
    setRenaming(null);
    refresh();
  };

  const importJson = async (file: File) => {
    try {
      const p = await readPlanFile(file);
      setError(null);
      switchTo(`Importing “${p.name}”`, () => finishSwitch(p, `Imported “${p.name}”`));
    } catch (err) {
      setError(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const sectionTitle = (text: string, right?: ReactNode) => (
    <div className="mb-2 flex items-center gap-2">
      <h3 className="flex-1 text-[13px] font-semibold text-ink">{text}</h3>
      {right}
    </div>
  );

  return (
    <Modal open width="max-w-4xl" icon={<FolderOpen />} title="Plans" onClose={close}>
      <div className="flex flex-col gap-5">
        {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">{error}</p>}

        {pending && (
          <div role="alertdialog" aria-label="Unsaved changes" className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-xs text-warn">
            <p className="min-w-60 flex-1">
              <span className="font-semibold">{pending.what}</span> replaces “{plan.name}”, which has unsaved changes.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setPending(null);
                  pending.run();
                }}
              >
                Discard changes
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  if (save()) {
                    setPending(null);
                    pending.run();
                  }
                }}
              >
                Save, then continue
              </Button>
            </div>
          </div>
        )}

        <section>
          {sectionTitle('Current plan')}
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-line p-3">
            <div className="mr-auto min-w-0">
              <p className="truncate text-sm font-medium text-ink">{plan.name}</p>
              <p className="text-xs text-muted">{currentSaved ? 'Saved in this browser; Save overwrites it.' : 'Not saved yet (autosaved as your working plan only).'}</p>
            </div>
            {saveAsName === null ? (
              <>
                <Button icon={<Save className="h-4 w-4" />} variant="primary" onClick={() => void save()}>
                  Save
                </Button>
                <Button onClick={() => setSaveAsName(currentSaved ? `${plan.name} (copy)` : plan.name)}>Save as…</Button>
              </>
            ) : (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (saveAsName.trim()) saveAs(saveAsName);
                }}
              >
                <TextInput autoFocus value={saveAsName} onChange={(e) => setSaveAsName(e.target.value)} aria-label="Save as name" className="w-64" />
                <Button type="submit" variant="primary" disabled={!saveAsName.trim()}>
                  Save
                </Button>
                <Button onClick={() => setSaveAsName(null)}>Cancel</Button>
              </form>
            )}
          </div>
        </section>

        <section>
          {sectionTitle('Saved plans', <span className="text-xs text-muted">{plans.length} in this browser</span>)}
          {plans.length === 0 ? (
            <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">No saved plans yet. Use Save to keep the current plan.</p>
          ) : (
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full text-sm">
                <thead className="bg-canvas text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                    <th className="px-3 py-2 font-medium">Units</th>
                    <th className="px-3 py-2 font-medium">Vehicles</th>
                    <th className="px-3 py-2" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {plans.map((p) => (
                    <tr key={p.id} className={p.id === plan.id ? 'bg-accent-soft/40' : ''}>
                      <td className="px-3 py-2">
                        {renaming?.id === p.id ? (
                          <form
                            className="flex items-center gap-1.5"
                            onSubmit={(e) => {
                              e.preventDefault();
                              commitRename();
                            }}
                          >
                            <TextInput
                              autoFocus
                              value={renaming.name}
                              onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  e.stopPropagation();
                                  setRenaming(null);
                                }
                              }}
                              aria-label="New name"
                              className="h-8"
                            />
                            <Button size="sm" type="submit" variant="primary" disabled={!renaming.name.trim()}>
                              Rename
                            </Button>
                          </form>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="font-medium text-ink">{p.name}</span>
                            {p.id === plan.id && <Chip tone="accent">Open</Chip>}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{formatUpdated(p.updatedAt)}</td>
                      <td className="px-3 py-2 text-xs">{p.units === 'metric' ? 'Metric' : 'Imperial'}</td>
                      <td className="max-w-56 truncate px-3 py-2 text-xs text-ink-soft" title={p.vehicles.join('\n')}>
                        {p.vehicles.join(', ')}
                      </td>
                      <td className="px-3 py-2">
                        {deleting === p.id ? (
                          <span className="flex items-center justify-end gap-1.5 text-xs">
                            <span className="text-bad">Delete?</span>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                attempt(() => deleteSavedPlan(p.id));
                                setDeleting(null);
                                refresh();
                                toast(`Deleted “${p.name}”`, 'info');
                              }}
                            >
                              Delete
                            </Button>
                            <Button size="sm" onClick={() => setDeleting(null)}>
                              Keep
                            </Button>
                          </span>
                        ) : (
                          <span className="flex items-center justify-end gap-0.5">
                            <Button size="sm" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => open(p)} disabled={p.id === plan.id && !hasUnsavedChanges(plan)}>
                              Open
                            </Button>
                            <IconButton label={`Rename ${p.name}`} size="sm" onClick={() => setRenaming({ id: p.id, name: p.name })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton
                              label={`Duplicate ${p.name}`}
                              size="sm"
                              onClick={() => {
                                const info = attempt(() => duplicateSavedPlan(p.id));
                                if (info) toast(`Created “${info.name}”`, 'success');
                                refresh();
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton label={`Delete ${p.name}`} size="sm" className="hover:text-bad" onClick={() => setDeleting(p.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconButton>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section>
            {sectionTitle('New plan')}
            <div className="flex flex-col gap-2 rounded-card border border-line p-3">
              <Button
                icon={<Sparkles className="h-4 w-4" />}
                className="justify-start"
                onClick={() => switchTo('Starting the sample plan', () => finishSwitch(createSeedPlan(), 'Started the sample plan'))}
              >
                New sample plan (5 stops, multi-temp reefer)
              </Button>
              <div className="flex gap-2">
                <Select value={preset} onChange={setPreset} options={VEHICLE_PRESETS.map((p) => ({ value: p.id, label: p.name }))} aria-label="Vehicle for the new plan" />
                <Button
                  icon={<FilePlus2 className="h-4 w-4" />}
                  onClick={() => switchTo('Starting an empty plan', () => finishSwitch(createEmptyPlan(preset), 'Started an empty plan'))}
                >
                  New empty plan
                </Button>
              </div>
            </div>
          </section>
          <section>
            {sectionTitle('Files')}
            <div className="flex flex-col gap-2 rounded-card border border-line p-3">
              <div className="flex flex-wrap gap-2">
                <Button icon={<Download className="h-4 w-4" />} onClick={() => downloadPlanJson(plan)}>
                  Export plan JSON
                </Button>
                <Button icon={<Upload className="h-4 w-4" />} onClick={() => jsonInput.current?.click()}>
                  Import plan JSON…
                </Button>
                <Button icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => downloadItemsCsv(plan)}>
                  Export items CSV
                </Button>
              </div>
              <p className="text-xs text-muted">JSON files hold the complete plan (exact round trip) and can be opened on any computer.</p>
              <input
                ref={jsonInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label="Plan JSON file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importJson(file);
                  e.target.value = '';
                }}
              />
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
}
