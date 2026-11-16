/**
 * Flash listing tags observed as `fs_DD_MM_YYYY_HHstart_HHend`
 * (collection-level window, not product-specific expiry).
 * Hours are treated as Turkey wall-clock (UTC+3, no DST).
 */
const FLASH_TAG_RE =
  /^fs_(\d{2})_(\d{2})_(\d{4})_(\d{1,2})_(\d{1,2})$/i;

const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

export type FlashTagWindow = {
  tag: string;
  start: Date;
  end: Date;
};

function trLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
): Date {
  // hour may be 24 → next midnight
  const base = Date.UTC(year, month - 1, day, 0, 0, 0) - TR_OFFSET_MS;
  return new Date(base + hour * 60 * 60 * 1000);
}

export function parseFlashSaleTag(tag: string): FlashTagWindow | null {
  const m = String(tag || '')
    .trim()
    .match(FLASH_TAG_RE);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const startHour = Number(m[4]);
  const endHour = Number(m[5]);
  if (
    ![day, month, year, startHour, endHour].every((n) => Number.isFinite(n)) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    startHour < 0 ||
    startHour > 24 ||
    endHour < 0 ||
    endHour > 24 ||
    endHour <= startHour
  ) {
    return null;
  }
  const start = trLocalToUtc(year, month, day, startHour);
  const end = trLocalToUtc(year, month, day, endHour);
  if (!(end.getTime() > start.getTime())) return null;
  return { tag: m[0].toLowerCase(), start, end };
}

export function earliestFlashWindowEnd(
  tags: string[],
  now = new Date(),
): Date | null {
  let earliest: Date | null = null;
  for (const tag of tags) {
    const w = parseFlashSaleTag(tag);
    if (!w) continue;
    if (w.end.getTime() <= now.getTime()) continue;
    if (!earliest || w.end.getTime() < earliest.getTime()) earliest = w.end;
  }
  return earliest;
}

/** Extract `fs_*` tags from a Trendyol `/sr?tag=` or combined tag query. */
export function extractFlashTagsFromQuery(
  tagParam: string | null | undefined,
): string[] {
  if (!tagParam) return [];
  return String(tagParam)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => FLASH_TAG_RE.test(t));
}
