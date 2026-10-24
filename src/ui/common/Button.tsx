import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong shadow-sm',
  secondary: 'bg-card text-ink border border-line hover:border-line-strong hover:bg-canvas',
  ghost: 'text-ink-soft hover:bg-black/5',
  danger: 'bg-card text-bad border border-bad/30 hover:bg-bad-soft',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

const BASE =
  'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors select-none disabled:opacity-45 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function Button({ variant = 'secondary', size = 'md', icon, className = '', children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'icon'> {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  active?: boolean;
}

export function IconButton({ label, active, variant = 'ghost', size = 'md', className = '', children, type = 'button', ...rest }: IconButtonProps) {
  const square = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`${BASE} ${VARIANTS[variant]} ${square} ${active ? 'bg-black/8 text-ink' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
