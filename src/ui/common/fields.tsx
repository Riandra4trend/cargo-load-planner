import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import type { MaterialState, UnitSystem } from '../../domain/types';
import { fromKg, fromMetres, kgToLb, L_PER_CU_YD, L_PER_US_GAL, M_PER_FT, parseNumber, toKg, toMetres, type LengthUnit, type WeightUnit, LENGTH_UNITS, WEIGHT_UNITS } from '../../domain/units';

export const inputClass =
  'h-9 w-full rounded-lg border border-line bg-card px-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-canvas disabled:text-muted';

export function Field({ label, hint, error, children, className = '' }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-xs ${className}`}>
      <span className="font-medium text-ink-soft">{label}</span>
      {children}
      {error ? <span className="text-bad">{error}</span> : hint ? <span className="text-muted">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`} {...rest} />;
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className = '',
  ...rest
}: { value: T; onChange: (value: T) => void; options: SelectOption<T>[] } & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={`${inputClass} pr-7 ${className}`} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={`flex items-start gap-2.5 ${disabled ? 'opacity-50' : ''}`}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${checked ? 'bg-accent' : 'bg-line-strong'}`}
      >
        <span className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <label htmlFor={id} className="flex cursor-pointer flex-col text-xs">
        <span className="font-medium text-ink">{label}</span>
        {hint && <span className="text-muted">{hint}</span>}
      </label>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: 'sm' | 'md';
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-canvas p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md font-medium transition-colors ${size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm'} ${
            o.value === value ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const trimNumber = (n: number, digits: number): string => (Number.isFinite(n) ? String(Number(n.toFixed(digits))) : '');

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max'> {
  value: number;
  onChange: (value: number) => void;
  digits?: number;
  min?: number;
  max?: number;
  suffix?: ReactNode;
}

/** Numeric input that keeps the user's text while typing and reports every valid value. */
export function NumberInput({ value, onChange, digits = 2, min, max, suffix, className = '', ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null ? value : parseNumber(draft);
  const invalid = draft !== null && (!Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max));
  return (
    <div className="relative min-w-0">
      <input
        inputMode="decimal"
        value={draft ?? trimNumber(value, digits)}
        onFocus={() => setDraft(trimNumber(value, digits))}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseNumber(e.target.value);
          if (Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) onChange(n);
        }}
        aria-invalid={invalid}
        className={`${inputClass} num ${suffix ? 'pr-10' : ''} ${invalid ? 'border-bad focus:border-bad focus:ring-bad/20' : ''} ${className}`}
        {...rest}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
    </div>
  );
}

const LENGTH_INPUT_DIGITS: Record<LengthUnit, number> = { mm: 0, cm: 1, m: 3, in: 2, ft: 3 };
const WEIGHT_INPUT_DIGITS: Record<WeightUnit, number> = { kg: 1, t: 3, lb: 1 };

/** Length input: value in metres, displayed and typed in `unit`. Optional unit picker. */
export function LengthInput({
  metres,
  onChange,
  unit,
  onUnitChange,
  min = 0,
  ...rest
}: { metres: number; onChange: (metres: number) => void; unit: LengthUnit; onUnitChange?: (unit: LengthUnit) => void; min?: number } & Omit<NumberInputProps, 'value' | 'onChange' | 'suffix' | 'min'>) {
  const input = (
    <NumberInput value={fromMetres(metres, unit)} onChange={(n) => onChange(toMetres(n, unit))} digits={LENGTH_INPUT_DIGITS[unit]} min={min} suffix={onUnitChange ? undefined : unit} {...rest} />
  );
  if (!onUnitChange) return input;
  return (
    <div className="flex gap-1">
      <div className="min-w-0 flex-1">{input}</div>
      <div className="w-[4.5rem] shrink-0">
        <Select value={unit} onChange={onUnitChange} options={LENGTH_UNITS.map((u) => ({ value: u, label: u }))} aria-label="Length unit" />
      </div>
    </div>
  );
}

/** Weight input: value in kg, displayed and typed in `unit`. Optional unit picker. */
export function WeightInput({
  kg,
  onChange,
  unit,
  onUnitChange,
  min = 0,
  ...rest
}: { kg: number; onChange: (kg: number) => void; unit: WeightUnit; onUnitChange?: (unit: WeightUnit) => void; min?: number } & Omit<NumberInputProps, 'value' | 'onChange' | 'suffix' | 'min'>) {
  const input = <NumberInput value={fromKg(kg, unit)} onChange={(n) => onChange(toKg(n, unit))} digits={WEIGHT_INPUT_DIGITS[unit]} min={min} suffix={onUnitChange ? undefined : unit} {...rest} />;
  if (!onUnitChange) return input;
  return (
    <div className="flex gap-1">
      <div className="min-w-0 flex-1">{input}</div>
      <div className="w-[4.5rem] shrink-0">
        <Select value={unit} onChange={onUnitChange} options={WEIGHT_UNITS.map((u) => ({ value: u, label: u }))} aria-label="Weight unit" />
      </div>
    </div>
  );
}

/** Liquid volume input: value in litres, typed in L (metric) or US gallons (imperial). */
export function LitresInput({
  litres,
  onChange,
  sys,
  min = 0,
  ...rest
}: { litres: number; onChange: (litres: number) => void; sys: UnitSystem; min?: number } & Omit<NumberInputProps, 'value' | 'onChange' | 'suffix' | 'min'>) {
  const perUnit = sys === 'metric' ? 1 : L_PER_US_GAL;
  return <NumberInput value={litres / perUnit} onChange={(n) => onChange(n * perUnit)} digits={sys === 'metric' ? 1 : 2} min={min / perUnit} suffix={sys === 'metric' ? 'L' : 'gal'} {...rest} />;
}

/** Material volume input: value in litres, typed in L / US gal for liquids and m³ / cubic yards for dry bulk. */
export function MaterialVolumeInput({
  litres,
  onChange,
  state,
  sys,
  min = 0,
  ...rest
}: { litres: number; onChange: (litres: number) => void; state: MaterialState; sys: UnitSystem; min?: number } & Omit<NumberInputProps, 'value' | 'onChange' | 'suffix' | 'min'>) {
  if (state === 'liquid') return <LitresInput litres={litres} onChange={onChange} sys={sys} min={min} {...rest} />;
  const perUnit = sys === 'metric' ? 1000 : L_PER_CU_YD;
  return <NumberInput value={litres / perUnit} onChange={(n) => onChange(n * perUnit)} digits={2} min={min / perUnit} suffix={sys === 'metric' ? 'm³' : 'yd³'} {...rest} />;
}

/** Material density input: value in kg/L; liquids typed in kg/L or lb/gal, dry bulk in t/m³ or lb/ft³. */
export function MaterialDensityInput({
  kgPerL,
  onChange,
  state,
  sys,
  ...rest
}: { kgPerL: number; onChange: (kgPerL: number) => void; state: MaterialState; sys: UnitSystem } & Omit<NumberInputProps, 'value' | 'onChange' | 'suffix'>) {
  if (sys === 'metric') return <NumberInput value={kgPerL} onChange={onChange} digits={state === 'liquid' ? 3 : 2} suffix={state === 'liquid' ? 'kg/L' : 't/m³'} {...rest} />;
  // Imperial: lb per US gallon for liquids, lb per cubic foot for dry bulk.
  const perKgPerL = state === 'liquid' ? kgToLb(1) * L_PER_US_GAL : kgToLb(1000) * M_PER_FT ** 3;
  return <NumberInput value={kgPerL * perKgPerL} onChange={(n) => onChange(n / perKgPerL)} digits={state === 'liquid' ? 2 : 1} suffix={state === 'liquid' ? 'lb/gal' : 'lb/ft³'} {...rest} />;
}
