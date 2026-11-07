/**
 * PDP options vs descriptive attributes.
 *
 * Authoritative commerce rule (admin + legacy cart/order):
 * - At most ONE purchasable option group per product (PAV ids used as
 *   productAttributeValueId).
 * - Import/crawler signal: selection variants carry price and/or quantity===0;
 *   descriptive fix-attributes typically have price=null and quantity=-1.
 *
 * Multi-value alone is NOT sufficient — descriptive multi-value groups
 * (e.g. safety info) must not become purchase options.
 */

import {
  effectiveSellPrice,
  isRealSale,
  visibleDiscountPercent,
} from './storefront-plp.pricing';
import { isExcludedFilterAttributeName } from './storefront-plp.filters';
import type {
  StorefrontPdpAttributeRow,
  StorefrontPdpOptionGroup,
  StorefrontPdpOptionValue,
} from './storefront-pdp.types';

export type RawPdpPav = {
  id: number;
  quantity: number;
  price: number | null;
  discountedPrice: number | null;
  attributeValue?: {
    id?: number;
    name?: string | null;
    extraValue?: string | null;
    attributeId?: number;
    attribute?: {
      id?: number;
      name?: string | null;
      type?: string | null;
    } | null;
  } | null;
};

function roundMoney(value: number): number {
  return Math.round(value);
}

function isOptionAvailable(quantity: number): boolean {
  return quantity !== 0;
}

/** Crawler/admin commerce signal for a purchasable variant line. */
export function pavHasCommerceSignal(pav: RawPdpPav): boolean {
  if (pav.price != null && Number.isFinite(Number(pav.price))) return true;
  if (Number(pav.quantity) === 0) return true;
  return false;
}

type GroupBucket = {
  attributeId: number;
  name: string;
  type: string;
  values: StorefrontPdpOptionValue[];
  raw: RawPdpPav[];
};

function toTomanPrice(
  tryPrice: number | null | undefined,
  tryToToman: number,
): number | null {
  if (tryPrice == null || !Number.isFinite(Number(tryPrice))) return null;
  const n = Number(tryPrice);
  if (n <= 0) return null;
  return roundMoney(n * tryToToman);
}

function mapOptionValue(
  pav: RawPdpPav,
  tryToToman: number,
  allowDiscount: boolean,
): StorefrontPdpOptionValue {
  const label = String(pav.attributeValue?.name || '').trim() || '—';
  const swatch = pav.attributeValue?.extraValue
    ? String(pav.attributeValue.extraValue).trim() || null
    : null;

  const listTry = pav.price != null ? Number(pav.price) : null;
  const saleTry = allowDiscount && pav.discountedPrice != null
    ? Number(pav.discountedPrice)
    : null;
  const hasOwnPrice = listTry != null && listTry > 0;
  const hasSale = hasOwnPrice && isRealSale(listTry, saleTry);
  const currentTry = hasOwnPrice ? effectiveSellPrice(listTry, saleTry) : null;

  return {
    id: pav.id,
    label,
    swatch,
    available: isOptionAvailable(Number(pav.quantity)),
    price: currentTry != null ? toTomanPrice(currentTry, tryToToman) : null,
    compareAtPrice:
      hasSale && listTry != null ? toTomanPrice(listTry, tryToToman) : null,
    discount: hasSale ? visibleDiscountPercent(listTry, saleTry) : null,
  };
}

function groupHasCommerceSignal(group: GroupBucket): boolean {
  return group.raw.some(pavHasCommerceSignal);
}

function toDescriptiveRow(group: GroupBucket): StorefrontPdpAttributeRow {
  const seen = new Set<string>();
  const uniqueLabels: string[] = [];
  for (const v of group.values) {
    const key = normalizeLabelKey(v.label);
    if (!key || key === '—' || seen.has(key)) continue;
    seen.add(key);
    uniqueLabels.push(v.label.trim());
  }
  return {
    attributeId: group.attributeId,
    name: group.name,
    value: uniqueLabels.join('، ') || '—',
  };
}

function normalizeLabelKey(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Collapse identical customer-visible option labels (keep first PAV id). */
export function dedupeOptionValuesByLabel(
  values: StorefrontPdpOptionValue[],
): StorefrontPdpOptionValue[] {
  const seen = new Set<string>();
  const out: StorefrontPdpOptionValue[] = [];
  for (const value of values) {
    const key = normalizeLabelKey(value.label);
    if (!key || key === '—') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function dedupeAttributeRows(
  rows: StorefrontPdpAttributeRow[],
): StorefrontPdpAttributeRow[] {
  const seen = new Set<string>();
  const out: StorefrontPdpAttributeRow[] = [];
  for (const row of rows) {
    const key = `${normalizeLabelKey(row.name)}|${normalizeLabelKey(
      row.value,
    )}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...row,
      name: row.name.trim().replace(/\s+/g, ' '),
      value: row.value.trim().replace(/\s+/g, ' '),
    });
  }
  return out;
}

/**
 * Split PAVs into at most one purchasable option group + descriptive rows.
 */
export function mapStorefrontPdpAttributesAndOptions(
  pavs: RawPdpPav[] | null | undefined,
  tryToToman: number,
  allowDiscount = true,
): {
  options: StorefrontPdpOptionGroup[];
  attributes: StorefrontPdpAttributeRow[];
} {
  const groups = new Map<number, GroupBucket>();

  for (const pav of Array.isArray(pavs) ? pavs : []) {
    if (!pav || pav.id == null) continue;
    const attr = pav.attributeValue?.attribute;
    const attributeId =
      Number(attr?.id) || Number(pav.attributeValue?.attributeId) || 0;
    if (!attributeId) continue;

    const name = String(attr?.name || '').trim();
    if (!name || isExcludedFilterAttributeName(name)) continue;

    const existing = groups.get(attributeId);
    const value = mapOptionValue(pav, tryToToman, allowDiscount);
    if (existing) {
      existing.values.push(value);
      existing.raw.push(pav);
    } else {
      groups.set(attributeId, {
        attributeId,
        name,
        type: String(attr?.type || 'other'),
        values: [value],
        raw: [pav],
      });
    }
  }

  const options: StorefrontPdpOptionGroup[] = [];
  const attributes: StorefrontPdpAttributeRow[] = [];

  const sorted = [...groups.values()].sort(
    (a, b) => a.attributeId - b.attributeId,
  );

  const singles: GroupBucket[] = [];
  const multis: GroupBucket[] = [];
  for (const group of sorted) {
    group.values.sort((a, b) =>
      a.label.localeCompare(b.label, 'fa', { numeric: true }),
    );
    group.values = dedupeOptionValuesByLabel(group.values);
    if (group.values.length > 1) multis.push(group);
    else if (group.values.length === 1) singles.push(group);
  }

  const signaled = multis.filter(groupHasCommerceSignal);
  const silent = multis.filter((g) => !groupHasCommerceSignal(g));

  let optionGroup: GroupBucket | null = null;
  if (signaled.length >= 1) {
    // Prefer first commerce-signaled group (stable by attributeId).
    optionGroup = signaled[0];
  } else if (silent.length === 1) {
    // Admin/legacy sizes often lack own price — single silent multi is OK.
    optionGroup = silent[0];
  }
  // Several silent multis → none become options (avoid safety-info-as-size).

  if (optionGroup) {
    options.push({
      attributeId: optionGroup.attributeId,
      name: optionGroup.name,
      type: optionGroup.type,
      required: true,
      values: optionGroup.values,
    });
  }

  for (const group of singles) {
    attributes.push(toDescriptiveRow(group));
  }
  for (const group of multis) {
    if (optionGroup && group.attributeId === optionGroup.attributeId) continue;
    attributes.push(toDescriptiveRow(group));
  }

  return {
    options,
    attributes: dedupeAttributeRows(attributes),
  };
}
