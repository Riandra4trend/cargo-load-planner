import { ArrowLeft, ArrowRight, CircleAlert, ClipboardPaste, FileSpreadsheet, Info, MapPin, TriangleAlert, Upload } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import { TEMP_LABELS } from '../../domain/colors';
import type { UnitSystem } from '../../domain/types';
import { formatDims, formatWeight, LENGTH_UNITS, WEIGHT_UNITS, type LengthUnit, type WeightUnit } from '../../domain/units';
import { autoMapColumns, bindNewStops, IMPORT_FIELDS, parseCsvText, rowsToLines, type FieldDef, type FieldMapping, type ImportReportEntry, type ParsedCsv } from '../../io/csvImport';
import { useUnitSystem } from '../../state/hooks';
import { useStore } from '../../state/store';
import { Button } from '../common/Button';
import { Chip } from '../common/Chip';
import { Field, Select, inputClass } from '../common/fields';
import { Modal } from '../common/Modal';

type Step = 'source' | 'mapping' | 'review';
const STEPS: { key: Step; label: string }[] = [
  { key: 'source', label: '1 · Source' },
  { key: 'mapping', label: '2 · Map columns' },
  { key: 'review', label: '3 · Review' },
];
const PREVIEW_ROWS = 5;
const NOT_MAPPED = '';
const GROUPS: FieldDef['group'][] = ['Item', 'Delivery', 'Handling', 'Hazmat', 'Details'];
const DELIMITER_LABEL: Record<ParsedCsv['delimiter'], string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab' };

const defaultLengthUnit = (sys: UnitSystem): LengthUnit => (sys === 'metric' ? 'cm' : 'in');
const defaultWeightUnit = (sys: UnitSystem): WeightUnit => (sys === 'metric' ? 'kg' : 'lb');

function ReportList({ entries }: { entries: ImportReportEntry[] }) {
  if (!entries.length) return <p className="rounded-lg bg-ok-soft px-3 py-2 text-xs text-ok">Every row is valid.</p>;
  return (
    <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line">
      {entries.map((e, i) => {
        const Icon = e.level === 'error' ? CircleAlert : e.level === 'warning' ? TriangleAlert : Info;
        const tone = e.level === 'error' ? 'text-bad' : e.level === 'warning' ? 'text-warn' : 'text-info';
        return (
          <li key={i} className="flex items-start gap-2 px-3 py-1.5 text-xs">
            <Icon className={`mt-px h-3.5 w-3.5 shrink-0 ${tone}`} />
            <span className="w-14 shrink-0 font-mono text-muted num">{e.row ? `Row ${e.row}` : 'File'}</span>
            <span className="text-ink">{e.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Bulk item import: file or paste -> column mapping with live preview -> per-row report -> import. */
export function CsvImportDialog() {
  const sys = useUnitSystem();
  const plan = useStore((s) => s.plan);
  const closeDialog = useStore((s) => s.closeDialog);
  const addStop = useStore((s) => s.addStop);
  const addLines = useStore((s) => s.addLines);
  const setHighlightLines = useStore((s) => s.setHighlightLines);
  const toast = useStore((s) => s.toast);

  const [step, setStep] = useState<Step>('source');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>(defaultLengthUnit(sys));
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(defaultWeightUnit(sys));
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const close = useCallback(() => closeDialog('import'), [closeDialog]);

  const result = useMemo(() => (parsed ? rowsToLines(parsed.rows, mapping, { lengthUnit, weightUnit }, plan) : null), [parsed, mapping, lengthUnit, weightUnit, plan]);
  const missingRequired = IMPORT_FIELDS.filter((f) => f.required && mapping[f.field] === undefined);

  const readFile = async (file: File) => {
    setFileName(file.name);
    setText(await file.text());
    setParseError(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  const goToMapping = () => {
    try {
      const p = parseCsvText(text);
      const auto = autoMapColumns(p.headers);
      setParsed(p);
      setMapping(auto.mapping);
      setLengthUnit(auto.lengthUnit ?? defaultLengthUnit(sys));
      setWeightUnit(auto.weightUnit ?? defaultWeightUnit(sys));
      setParseError(null);
      setStep('mapping');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
  };

  const doImport = () => {
    if (!result || !result.lines.length) return;
    const stopIds = result.newStops.map((s) => addStop({ name: s.name, customerName: s.customerName }));
    const ids = addLines(bindNewStops(result.lines, result.newStops, stopIds));
    setHighlightLines(ids);
    const units = result.lines.reduce((n, l) => n + l.quantity, 0);
    const parts = [`Imported ${ids.length} line${ids.length === 1 ? '' : 's'} (${units} unit${units === 1 ? '' : 's'})`];
    if (result.newStops.length) parts.push(`${result.newStops.length} new stop${result.newStops.length === 1 ? '' : 's'}`);
    if (result.skipped) parts.push(`${result.skipped} row${result.skipped === 1 ? '' : 's'} skipped`);
    toast(parts.join(' · '), result.skipped ? 'info' : 'success');
    close();
  };

  const counts = result
    ? {
        errors: result.report.filter((r) => r.level === 'error').length,
        warnings: result.report.filter((r) => r.level === 'warning').length,
        units: result.lines.reduce((n, l) => n + l.quantity, 0),
      }
    : null;

  const columnOptions = parsed
    ? [{ value: NOT_MAPPED, label: '— not mapped —' }, ...parsed.headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }))]
    : [];
  const stopName = (id: string) => plan.stops.find((s) => s.id === id)?.name ?? result?.newStops.find((s) => s.key === id)?.name ?? '';

  const footer = (
    <>
      {step !== 'source' && (
        <Button icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep(step === 'review' ? 'mapping' : 'source')} className="mr-auto">
          Back
        </Button>
      )}
      <Button onClick={close}>Cancel</Button>
      {step === 'source' && (
        <Button variant="primary" icon={<ArrowRight className="h-4 w-4" />} disabled={!text.trim()} onClick={goToMapping}>
          Map columns
        </Button>
      )}
      {step === 'mapping' && (
        <Button variant="primary" icon={<ArrowRight className="h-4 w-4" />} disabled={missingRequired.length > 0} onClick={() => setStep('review')}>
          Review
        </Button>
      )}
      {step === 'review' && (
        <Button variant="primary" disabled={!result?.lines.length} onClick={doImport}>
          Import {result?.lines.length ?? 0} line{result?.lines.length === 1 ? '' : 's'}
        </Button>
      )}
    </>
  );

  return (
    <Modal open width="max-w-4xl" icon={<FileSpreadsheet />} title="Import items from CSV or spreadsheet" onClose={close} footer={footer}>
      <ol className="mb-4 flex gap-2 text-xs" aria-label="Import steps">
        {STEPS.map((s) => (
          <li key={s.key} aria-current={s.key === step ? 'step' : undefined} className={`rounded-full px-3 py-1 font-medium ${s.key === step ? 'bg-accent-soft text-accent-strong' : 'bg-canvas text-muted'}`}>
            {s.label}
          </li>
        ))}
      </ol>

      {step === 'source' && (
        <div className="flex flex-col gap-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-2 rounded-card border-2 border-dashed px-4 py-7 text-center transition-colors ${dragOver ? 'border-accent bg-accent-soft' : 'border-line-strong bg-canvas/60'}`}
          >
            <Upload className="h-6 w-6 text-muted" />
            <p className="text-sm text-ink">Drop a .csv, .tsv or .txt file here</p>
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              Choose file…
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              className="hidden"
              aria-label="CSV file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readFile(file);
                e.target.value = '';
              }}
            />
            {fileName && <p className="text-xs text-muted">Loaded {fileName}</p>}
          </div>
          <Field label={<span className="inline-flex items-center gap-1.5"><ClipboardPaste className="h-3.5 w-3.5" /> Or paste cells from Excel / Google Sheets (first row = headers)</span>}>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFileName(null);
                setParseError(null);
              }}
              rows={8}
              spellCheck={false}
              placeholder={'Item\tQty\tLength (cm)\tWidth (cm)\tHeight (cm)\tWeight (kg)\tStop\nApparel cartons\t4\t120\t80\t160\t320\tNordWear Outlet'}
              className={`${inputClass} h-auto py-2 font-mono text-xs`}
            />
          </Field>
          {parseError && <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">{parseError}</p>}
          <p className="text-xs text-muted">
            Columns are matched automatically (name, SKU, length, width, height, weight, quantity, stop, customer, temperature, UN number, hazmat class and more). Unit suffixes such as
            “Length (in)” or “weight_kg” are detected; units written in a cell (“48 in”, “500 lb”) override the column unit.
          </p>
        </div>
      )}

      {step === 'mapping' && parsed && result && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <p className="mr-auto text-xs text-muted">
              {parsed.rows.length} data row{parsed.rows.length === 1 ? '' : 's'} · {parsed.headers.length} columns · {DELIMITER_LABEL[parsed.delimiter]}-separated
            </p>
            <Field label="Lengths in" className="w-28">
              <Select value={lengthUnit} onChange={setLengthUnit} options={LENGTH_UNITS.map((u) => ({ value: u, label: u }))} aria-label="Length unit" />
            </Field>
            <Field label="Weights in" className="w-28">
              <Select value={weightUnit} onChange={setWeightUnit} options={WEIGHT_UNITS.map((u) => ({ value: u, label: u }))} aria-label="Weight unit" />
            </Field>
          </div>
          {missingRequired.length > 0 && (
            <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">Map a column to: {missingRequired.map((f) => f.label.toLowerCase()).join(', ')}.</p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {GROUPS.map((group) => (
              <fieldset key={group} className="rounded-card border border-line p-3">
                <legend className="px-1 text-xs font-semibold text-ink">{group}</legend>
                <div className="flex flex-col gap-1.5">
                  {IMPORT_FIELDS.filter((f) => f.group === group).map((f) => (
                    <label key={f.field} className="grid grid-cols-[9.5rem_minmax(0,1fr)] items-center gap-2 text-xs">
                      <span className={mapping[f.field] === undefined ? 'text-muted' : 'font-medium text-ink'}>
                        {f.label}
                        {f.required && <span className="text-bad"> *</span>}
                      </span>
                      <Select
                        value={mapping[f.field] === undefined ? NOT_MAPPED : String(mapping[f.field])}
                        onChange={(value) => {
                          const next = { ...mapping };
                          if (value === NOT_MAPPED) delete next[f.field];
                          else next[f.field] = Number(value);
                          setMapping(next);
                        }}
                        options={columnOptions}
                        className="h-8 text-xs"
                        aria-label={`Column for ${f.label}`}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <div>
            <h3 className="mb-1.5 text-[13px] font-semibold">Preview (first {Math.min(PREVIEW_ROWS, parsed.rows.length)} rows as they will be imported)</h3>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="bg-canvas text-left text-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Row</th>
                    <th className="px-2 py-1.5 font-medium">Item</th>
                    <th className="px-2 py-1.5 font-medium">Qty</th>
                    <th className="px-2 py-1.5 font-medium">Dimensions</th>
                    <th className="px-2 py-1.5 font-medium">Weight</th>
                    <th className="px-2 py-1.5 font-medium">Stop</th>
                    <th className="px-2 py-1.5 font-medium">Temp / hazmat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {parsed.rows.slice(0, PREVIEW_ROWS).map((_, i) => {
                    const rowNo = i + 2;
                    const li = result.rowOfLine.indexOf(rowNo);
                    const line = li >= 0 ? result.lines[li] : null;
                    const rowErrors = result.report.filter((r) => r.row === rowNo && r.level === 'error');
                    return (
                      <tr key={rowNo} className={line ? '' : 'bg-bad-soft/50'}>
                        <td className="px-2 py-1.5 font-mono text-muted num">{rowNo}</td>
                        {line ? (
                          <>
                            <td className="px-2 py-1.5 text-ink">{line.spec.name}</td>
                            <td className="px-2 py-1.5 font-mono num">{line.quantity}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 font-mono num">{formatDims(line.spec.dims, sys)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 font-mono num">{formatWeight(line.spec.weightKg, sys)}</td>
                            <td className="px-2 py-1.5">
                              {stopName(line.stopId)}
                              {result.newStops.some((s) => s.key === line.stopId) && (
                                <Chip tone="info" className="ml-1">
                                  New
                                </Chip>
                              )}
                            </td>
                            <td className="px-2 py-1.5">
                              {TEMP_LABELS[line.spec.temp]}
                              {line.spec.hazmat ? ` · ${line.spec.hazmat.unNumber} (${line.spec.hazmat.hazClass})` : ''}
                            </td>
                          </>
                        ) : (
                          <td colSpan={6} className="px-2 py-1.5 text-bad">
                            {rowErrors.map((r) => r.message).join('; ') || 'Skipped'}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {step === 'review' && result && counts && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Lines to import', value: result.lines.length, tone: 'text-ink' },
              { label: 'Units', value: counts.units, tone: 'text-ink' },
              { label: 'Rows skipped', value: result.skipped, tone: result.skipped ? 'text-bad' : 'text-ink' },
              { label: 'Warnings', value: counts.warnings, tone: counts.warnings ? 'text-warn' : 'text-ink' },
            ].map((c) => (
              <div key={c.label} className="rounded-card border border-line px-3 py-2">
                <div className="text-[11px] text-muted">{c.label}</div>
                <div className={`font-mono text-lg font-semibold num ${c.tone}`}>{c.value}</div>
              </div>
            ))}
          </div>
          {result.newStops.length > 0 && (
            <div className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                <MapPin className="h-3.5 w-3.5" /> {result.newStops.length} new stop{result.newStops.length === 1 ? '' : 's'} will be added at the end of the route:
              </p>
              <ul className="list-inside list-disc text-ink-soft">
                {result.newStops.map((s) => (
                  <li key={s.key}>
                    {s.name}
                    {s.customerName !== s.name ? ` (${s.customerName})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="mb-1.5 text-[13px] font-semibold">
              Report{counts.errors ? ` · ${counts.errors} error${counts.errors === 1 ? '' : 's'}` : ''}
            </h3>
            <ReportList entries={result.report} />
          </div>
          {!result.lines.length && <p className="text-xs text-bad">Nothing to import: fix the rows above in your spreadsheet or change the column mapping.</p>}
        </div>
      )}
    </Modal>
  );
}
