import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`bg-card border border-line rounded-card shadow-card ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ icon, title, right, className = '' }: { icon?: ReactNode; title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {icon && <span className="text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      <h3 className="flex-1 text-[13px] font-semibold text-ink">{title}</h3>
      {right}
    </div>
  );
}
