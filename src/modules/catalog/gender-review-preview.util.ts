import { GenderRelevanceAttribute } from './gender-relevance';

export type GenderReviewSourceAttribute = {
  name: string | null;
  sourceName: string | null;
  values: string[];
};

export type GenderReviewPreviewAttributes = {
  variantSizes: string[];
  sourceAttributes: GenderReviewSourceAttribute[];
};

const MAX_SOURCE_ATTRIBUTE_GROUPS = 20;

function foldLabel(value: string | null | undefined): string {
  return String(value || '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

function preferredValue(attr: GenderRelevanceAttribute): string {
  const source = String(attr.valueSource || '').trim();
  if (source) return source;
  return String(attr.value || '').trim();
}

function isSizeAttribute(attr: GenderRelevanceAttribute): boolean {
  const label = foldLabel(`${attr.name || ''} ${attr.sourceName || ''}`);
  if (!label) return false;
  if (/(?:^|[^a-z0-9])beden(?:$|[^a-z0-9])/.test(label)) return true;
  if (label.includes('numara') || label.includes('shoe size')) return true;
  if (label.includes('سایز') || label.includes('سايز')) return true;
  return false;
}

function attributeGroupKey(attr: GenderRelevanceAttribute): string {
  const source = foldLabel(attr.sourceName);
  const name = foldLabel(attr.name);
  return source || name || 'attr';
}

function compareSizeLabels(a: string, b: string): number {
  const na = Number(String(a).replace(/,/g, '.').replace(/"/g, ''));
  const nb = Number(String(b).replace(/,/g, '.').replace(/"/g, ''));
  const aNum = Number.isFinite(na) && /^\d/.test(String(a).trim());
  const bNum = Number.isFinite(nb) && /^\d/.test(String(b).trim());
  if (aNum && bNum && na !== nb) return na - nb;
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  return String(a).localeCompare(String(b), 'tr');
}

/**
 * Read-only presentation of product attributes for the gender-review dialog.
 * Does not classify gender and does not write product data.
 */
export function buildGenderReviewPreviewAttributes(
  attributes: GenderRelevanceAttribute[] | null | undefined,
): GenderReviewPreviewAttributes {
  const sizeValues = new Set<string>();
  const groups = new Map<
    string,
    { name: string | null; sourceName: string | null; values: Set<string> }
  >();

  for (const attr of attributes || []) {
    const display = preferredValue(attr);
    if (!display) continue;
    if (isSizeAttribute(attr)) {
      sizeValues.add(display);
      continue;
    }
    const key = attributeGroupKey(attr);
    const existing = groups.get(key);
    if (existing) {
      existing.values.add(display);
      if (!existing.sourceName && attr.sourceName) {
        existing.sourceName = String(attr.sourceName);
      }
      if (!existing.name && attr.name) existing.name = String(attr.name);
      continue;
    }
    groups.set(key, {
      name: attr.name ? String(attr.name) : null,
      sourceName: attr.sourceName ? String(attr.sourceName) : null,
      values: new Set([display]),
    });
  }

  const sourceAttributes = [...groups.values()]
    .map((group) => ({
      name: group.name,
      sourceName: group.sourceName,
      values: [...group.values].sort((a, b) => a.localeCompare(b, 'tr')),
    }))
    .filter((group) => group.values.length > 0)
    .slice(0, MAX_SOURCE_ATTRIBUTE_GROUPS);

  return {
    variantSizes: [...sizeValues].sort(compareSizeLabels),
    sourceAttributes,
  };
}
