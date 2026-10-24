let counter = 0;

/** Short unique id with an optional readable prefix, e.g. "line_lq3k9a_1f". */
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return `${prefix}_${Date.now().toString(36)}${rand}${counter.toString(36)}`;
}
