import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Plan } from '../domain/types';
import { parsePlanJson } from './planFile';

const PREFIX = '#plan=';

/** URL of the current page with the whole plan compressed into the hash. */
export function buildShareUrl(plan: Plan, base: string = window.location.href): string {
  const url = base.split('#')[0];
  return `${url}${PREFIX}${compressToEncodedURIComponent(JSON.stringify(plan))}`;
}

/** Plan encoded in a location hash, or null when the hash holds no (valid) plan. */
export function readShareHash(hash: string): Plan | null {
  if (!hash.startsWith(PREFIX)) return null;
  const json = decompressFromEncodedURIComponent(hash.slice(PREFIX.length));
  if (!json) return null;
  try {
    return parsePlanJson(json);
  } catch {
    return null;
  }
}
