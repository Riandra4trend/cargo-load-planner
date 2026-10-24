import type { ReactNode } from 'react';
import type { AxleStatus, UnitStatus } from '../../domain/types';

export type ChipTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent';

const TONES: Record<ChipTone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
  neutral: 'bg-black/5 text-ink-soft',
  accent: 'bg-accent-soft text-accent-strong',
};

export function Chip({ tone = 'neutral', children, className = '', title }: { tone?: ChipTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

const AXLE_CHIP: Record<AxleStatus, [ChipTone, string]> = {
  legal: ['ok', 'Legal'],
  near: ['warn', 'Near limit'],
  over: ['bad', 'Over limit'],
  under: ['bad', 'Below minimum'],
};

export function AxleStatusChip({ status }: { status: AxleStatus }) {
  const [tone, text] = AXLE_CHIP[status];
  return <Chip tone={tone}>{text}</Chip>;
}

const UNIT_CHIP: Record<UnitStatus, [ChipTone, string]> = {
  planned: ['info', 'Planned'],
  loaded: ['ok', 'Loaded'],
  unplaced: ['neutral', 'Unplaced'],
  check: ['bad', 'Check'],
  urgent: ['accent', 'Urgent'],
};

export function UnitStatusChip({ status }: { status: UnitStatus }) {
  const [tone, text] = UNIT_CHIP[status];
  return <Chip tone={tone}>{text}</Chip>;
}

export function ColorDot({ color, size = 10, className = '' }: { color: string; size?: number; className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${className}`} style={{ background: color, width: size, height: size }} />;
}
