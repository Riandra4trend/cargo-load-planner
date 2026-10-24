import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Plan } from '../domain/types';
import { parsePlanJson } from './planFile';

export const SHARE_HASH_PREFIX = '#plan=';

/** Links longer than this (characters) risk truncation in chat apps, mail clients and some browsers. */
export const SHARE_URL_WARN_LENGTH = 8 * 1024;

/** URL of the current page with the whole plan compressed into the hash. */
export function buildShareUrl(plan: Plan, base: string = window.location.href): string {
  const url = base.split('#')[0];
  return `${url}${SHARE_HASH_PREFIX}${compressToEncodedURIComponent(JSON.stringify(plan))}`;
}

/** Plan encoded in a location hash, or null when the hash holds no (valid) plan. */
export function readShareHash(hash: string): Plan | null {
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return null;
  const json = decompressFromEncodedURIComponent(hash.slice(SHARE_HASH_PREFIX.length));
  if (!json) return null;
  try {
    return parsePlanJson(json);
  } catch {
    return null;
  }
}
