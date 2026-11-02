/** Keep a full-event selection while applying only the dragged rectangle/range. */
export function applySelectionRange(base: ReadonlySet<string>, range: readonly string[], adding: boolean): Set<string> {
  const next = new Set(base);
  for (const key of range) adding ? next.add(key) : next.delete(key);
  return next;
}

/** Reserve the left border and each column’s right border outside its hit target. */
export function visibleDateCount(width: number, timeWidth: number, cellWidth: number, total: number): number {
  return Math.max(1, Math.min(total || 1, Math.floor(Math.max(0, width - timeWidth - 1) / (cellWidth + 1))));
}

export function pageContaining(anchor: number, pageSize: number, total: number): number {
  return Math.floor(Math.max(0, Math.min(anchor, total - 1)) / pageSize) * pageSize;
}

/** Pixels/second. Content bounds prevent scrolling into another editor/panel. */
export function edgeScrollVelocity(y: number, top: number, bottom: number, contentTop: number, contentBottom: number): number {
  if (bottom <= top) return 0;
  const band = Math.min(40, (bottom - top) / 3);
  if (y < top + band && contentTop < top - 1) return -520 * Math.max(0, Math.min(1, (top + band - y) / band));
  if (y > bottom - band && contentBottom > bottom + 1) return 520 * Math.max(0, Math.min(1, (y - bottom + band) / band));
  return 0;
}

/** Arrow movement follows calendar columns, including month boundaries. */
export function nextCalendarDate(dates: readonly string[], current: string, dayStep: number): string {
  const available = new Set(dates);
  const candidate = new Date(`${current}T00:00:00Z`);
  for (;;) {
    candidate.setUTCDate(candidate.getUTCDate() + dayStep);
    const key = candidate.toISOString().slice(0, 10);
    if (key < dates[0] || key > dates[dates.length - 1]) return current;
    if (available.has(key)) return key;
  }
}
