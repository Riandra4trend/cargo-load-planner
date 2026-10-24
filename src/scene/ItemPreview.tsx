import type { ItemSpec } from '../domain/types';

export function ItemPreview({ spec, className = '' }: { spec: ItemSpec; className?: string }) {
  return <div className={`grid place-items-center text-xs text-muted ${className}`}>{spec.name}</div>;
}
