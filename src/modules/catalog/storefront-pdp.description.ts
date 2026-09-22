/**
 * PDP description presentation pipeline (source-agnostic, no DB mutation):
 *
 *   RAW IMPORTED CONTENT
 *           ↓
 *   HTML / MACHINE CLEANUP
 *           ↓
 *   CONTENT SEGMENTATION (line → sentence)
 *           ↓
 *   PRODUCT FACTS vs MARKETPLACE OPERATIONS
 *           ↓
 *   STRUCTURED ATTRIBUTE NEAR-DEDUP
 *           ↓
 *   LOW-VALUE RESIDUAL DROP
 *           ↓
 *   CUSTOMER PRESENTATION
 */

export type RawPdpDescription = {
  content?: string | null;
  sourceContent?: string | null;
  displayOrder?: number | null;
  isDeleted?: boolean | null;
};

export type DescriptionAttributeRef = {
  name?: string | null;
  value?: string | null;
};

/** ASCII + Eastern Arabic + Persian digits for marketplace copy. */
const DIGIT = '[0-9۰-۹٠-٩]';

const PRODUCT_FACT_SIGNAL =
  /(جنس|پارچه|پنبه|الیاف|ترکیب|مواد|ابعاد|اندازه|سایز|وزن|رنگ|مدل|طرح|فرم|بافت|فرمول|ترکیبات|ماده|ویژگی|کاربرد|استفاده|مراقبت|شستشو|نگهداری|هشدار|ایمنی|خطر|محتوا|بسته|سازگار|سازگاری|اثر|براق|مات|نرم|ضخامت|برش|فیت|آستین|یقه|ingredient|material|fabric|cotton|polyester|dimension|formula|texture|care|wash|warning|safety)/i;

// ---------------------------------------------------------------------------
// Stage 1 — HTML → plain text
// ---------------------------------------------------------------------------

/** Strip tags / scripts; collapse whitespace; keep readable text. */
export function stripHtmlToPlainText(input: string): string {
  let text = String(input);
  text = text.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n');
  text = text.replace(/<(br|hr)\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return text.trim();
}

// ---------------------------------------------------------------------------
// Stage 2 — machine / import markup cleanup
// ---------------------------------------------------------------------------

/**
 * Remove high-confidence ingestion / source-navigation tokens.
 */
export function stripImportMachineNoise(input: string): string {
  let text = String(input);

  // [page="merchant_info"]Label[/page] and similar
  text = text.replace(/\[page\s*=\s*["'][^"']*["']\][\s\S]*?\[\/page\]/gi, ' ');
  text = text.replace(
    /\[page\]\s*(?:\[[^\]]*\]|"[^"]*"|'[^']*'|[^\n[]*)?/gi,
    ' ',
  );
  text = text.replace(/\[["']?page["']?\s*:\s*["'][^"']*["']\]/gi, ' ');
  text = text.replace(/\bpage\s*=\s*[^\n]*?\/page\b/gi, ' ');
  text = text.replace(/\/page\b/gi, ' ');

  text = text.replace(/\bmerchant_info\b/gi, ' ');
  text = text.replace(/\breturn_conditions\b/gi, ' ');
  text = text.replace(/\bdelivery_info\b/gi, ' ');
  text = text.replace(/\bcampaign_info\b/gi, ' ');

  const lines = text
    .split('\n')
    .map((line) =>
      line
        .replace(/[\[\]{}"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => {
      if (!line) return false;
      if (/^[:\s,;._-]+$/.test(line)) return false;
      if (/^(page|key|value)\s*:/i.test(line) && line.length < 40) return false;
      return true;
    });

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Stage 3 — segmentation
// ---------------------------------------------------------------------------

export function splitIntoSentences(line: string): string[] {
  const parts = String(line)
    .split(/(?<=[.!?؟۔])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [line];
}

export function segmentDescriptionContent(input: string): string[] {
  const text = String(input || '').trim();
  if (!text) return [];

  const segments: string[] = [];
  for (const line of text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)) {
    const sentences = splitIntoSentences(line);
    for (const sentence of sentences) {
      const normalized = sentence.replace(/\s+/g, ' ').trim();
      if (normalized) segments.push(normalized);
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Stage 4 — marketplace operations vs product facts
// ---------------------------------------------------------------------------

/**
 * Normalize common Arabic/Persian orthography + digit forms so concept
 * matchers stay source-agnostic across import/translation variants.
 */
export function normalizeMarketplaceFaText(input: string): string {
  return String(input || '')
    .replace(/\u064A/g, '\u06CC') // Arabic Yeh → Persian Yeh
    .replace(/\u0643/g, '\u06A9') // Arabic Kaf → Persian Keheh
    .replace(/[\u0660-\u0669]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x0660 + 0x06f0),
    ) // Eastern Arabic digits → Persian digits
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Source-agnostic marketplace / commerce-platform operational prose.
 * Concept-based — not a single-retailer string list.
 */
export function isMarketplaceOperationalParagraph(paragraph: string): boolean {
  const line = normalizeMarketplaceFaText(
    String(paragraph || '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (!line) return true;

  const sellerConcept =
    /(فروشنده|فروشندگ|فروشگاه|چند\s*فروش|merchant|seller|vendors?|satıcı)/i;
  const rankingConcept =
    /(رتبه|رتبه‌بندی|رتبه بند|ranking|ranked|sıralama|مرتب\s*می‌شوند|مرتب میشوند)/i;
  const multiOfferConcept =
    /(چند(?:ین)?\s*فروشنده|توسط\s+چند(?:ین)?\s*فروشنده|multiple\s+sellers?|birden\s+fazla\s+satıcı|offered\s+by\s+multiple)/i;
  // Whole-line navigation / "more info" stubs (not product-feature bullets).
  const moreInfoStubConcept =
    /^(برای\s+(?:اطلاعات\s+بیشتر|جزئیات)|اطلاعات\s+بیشتر|مشاهده\s+جزئیات|for\s+more\s+(?:info|information)|for\s+details|click\s+(?:here|for\s+details)|daha\s+fazla\s+bilgi)[.!؟۔…,،:\s]*$/i;
  // Click-for-details / CTA navigation fragments (combo, not "جزئیات" alone).
  const navigationCtaConcept =
    /((?:برای\s+)?جزئیات[،,]?\s*کلیک|کلیک\s+کنید|مشاهده\s+جزئیات|click\s+(?:here|for\s+(?:more\s+)?details)|for\s+details[.,!]?\s*click)/i;
  // Seller / fulfillment: "فروش و ارسال توسط …", "ارسال توسط …", sold/shipped by.
  const fulfillmentConcept =
    /(فروش\s+و\s+ارسال\s+توسط|فروش\s+توسط|ارسال\s+توسط|ارسال\s+خواهد|توسط\s*ارسال\s+خواهد|توسط\s+.+\s+ارسال|sold\s+and\s+shipped\s+by|shipped\s+by|sold\s+by|fulfilled\s+by|kargoya\s+ver|teslim\s+edilecek)/i;
  const inventoryUrgencyConcept = new RegExp(
    `(کمتر\\s+از\\s+${DIGIT}+|بیش\\s+از\\s+${DIGIT}+\\s*.*(?:انبار|موجود|stock|stok)|تنها\\s+${DIGIT}+\\s+.+(باقی|مانده)|only\\s+${DIGIT}+\\s+left|${DIGIT}+\\s+adet\\s+(?:az\\s+)?(?:stok|kaldı)|son\\s+${DIGIT}+\\s+ürün)`,
    'i',
  );
  const campaignConcept =
    /(کمپین|campaign|kampanya|promosyon|marketplace\s+campaign|قیمت\s+ویژه)/i;
  // Return / refund logistics — covers بازگشت and مرجوعی wording.
  const returnPolicyConcept = new RegExp(
    `(شرایط\\s+بازگشت|بازگشت\\s+کالا|بازگشت\\s+رایگان|مدت\\s+${DIGIT}+\\s*روز.{0,40}بازگشت|بازگشت.{0,40}مدت\\s+${DIGIT}+|مرجوعی\\s+رایگان|امکان\\s+مرجوعی|مرجوعی.{0,40}${DIGIT}+\\s*روز|${DIGIT}+\\s*روز.{0,40}مرجوعی|return\\s+policy|return\\s+condition|free\\s+returns?|iade\\s+koşul|iade\\s+hakkı|ücretsiz\\s+iade)`,
    'i',
  );
  const deliveryPolicyConcept =
    /(شرایط\s+ارسال|اطلاعات\s+ارسال|delivery\s+info|kargo\s+bilgi|teslimat\s+koşul)/i;
  const pricingRuleConcept =
    /(قوانین\s+قیمت|price\s+rule|fiyatlandırma\s+kural)/i;
  const marketplaceLegalConcept =
    /(قوانین\s+بازارگاه|platform\s+rules?|pazar\s+yeri\s+kural)/i;
  // Order-qty / cancel rights — includes "حق … لغو" and "سفارشات بیش از N عدد".
  const orderLimitConcept = new RegExp(
    `(حداکثر\\s+${DIGIT}+\\s*(عدد|قلم)?|قابل\\s+سفارش|حق\\s+لغو\\s+سفارش|لغو\\s+سفارش|حق.{0,40}لغو.{0,40}سفارش|حق.{0,60}سفارش.{0,40}لغو|سفارشات?\\s+بیش\\s+از\\s+${DIGIT}+|بیش\\s+از\\s+${DIGIT}+\\s*عدد.{0,40}لغو|سفارش‌?های\\s+سازمانی|سفارش\\s+سازمانی|order\\s+limit|maximum\\s+${DIGIT}+\\s+(items?|units?)|cancel(?:lation)?\\s+rights?|right\\s+to\\s+cancel\\s+orders?)`,
    'i',
  );
  const onlinePurchaseOpsConcept =
    /(به\s+صورت\s+آنلاین\s+(?:یافت|خرید)|آنلاین\s+خریداری|web\s*color|خریداری\s+می‌شود)/i;

  if (multiOfferConcept.test(line)) return true;
  if (moreInfoStubConcept.test(line)) return true;
  if (navigationCtaConcept.test(line)) return true;
  if (sellerConcept.test(line) && rankingConcept.test(line)) return true;
  if (fulfillmentConcept.test(line)) return true;
  if (orderLimitConcept.test(line)) return true;
  if (
    inventoryUrgencyConcept.test(line) &&
    /(موجودی|انبار|stock|stok|فروشگاه|marketplace|فروشنده|seller|قیمت\s+ویژه|به\s+فروش|موجود\s+است)/i.test(
      line,
    )
  ) {
    return true;
  }
  if (campaignConcept.test(line) && inventoryUrgencyConcept.test(line)) {
    return true;
  }
  // Campaign + stock wording without "کمتر از" (e.g. special price / warehouse ops)
  if (
    campaignConcept.test(line) &&
    /(انبار|موجودی|stock|stok|به\s+فروش)/i.test(line)
  ) {
    return true;
  }
  if (returnPolicyConcept.test(line)) return true;
  if (deliveryPolicyConcept.test(line) && line.length > 35) return true;
  if (pricingRuleConcept.test(line)) return true;
  if (marketplaceLegalConcept.test(line)) return true;
  if (onlinePurchaseOpsConcept.test(line)) {
    return true;
  }

  if (
    sellerConcept.test(line) &&
    line.length > 80 &&
    !PRODUCT_FACT_SIGNAL.test(line)
  ) {
    return true;
  }

  return false;
}

export function keepProductFactSegments(segments: string[]): string[] {
  return segments.filter(
    (segment) => !isMarketplaceOperationalParagraph(segment),
  );
}

// ---------------------------------------------------------------------------
// Stage 5 — structured attribute near-dedup (exact / label:value only)
// ---------------------------------------------------------------------------

/**
 * Drop description lines that merely repeat structured attribute statements.
 * Does NOT drop explanatory prose that happens to mention an attribute value.
 */
export function omitLinesDuplicatingAttributes(
  input: string,
  attributes: DescriptionAttributeRef[] | null | undefined,
): string {
  const attrs = Array.isArray(attributes) ? attributes : [];
  if (!attrs.length) return String(input || '').trim();

  const exactValueSet = new Set<string>();
  const pairSet = new Set<string>();
  for (const a of attrs) {
    const name = String(a.name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const value = String(a.value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    // Only exact short value echoes (not substrings inside prose).
    if (value && value.length >= 2 && value.length <= 48) {
      exactValueSet.add(value);
    }
    if (name && value) pairSet.add(`${name}|${value}`);
  }

  const lines = String(input || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const kept = lines.filter((line) => {
    const normalized = line.replace(/\s+/g, ' ').trim().toLowerCase();
    // Exact whole-line echo of an attribute value only.
    if (exactValueSet.has(normalized)) return false;
    const pairMatch = normalized.match(/^(.+?)\s*[:：\-–]\s*(.+)$/);
    if (pairMatch) {
      const key = `${pairMatch[1].trim()}|${pairMatch[2].trim()}`;
      if (pairSet.has(key)) return false;
      // Only drop "Name: value" when the RHS is exactly the attribute value
      // and the line is a short label statement (not explanatory prose).
      if (
        exactValueSet.has(pairMatch[2].trim()) &&
        normalized.length <= pairMatch[2].trim().length + 24
      ) {
        return false;
      }
    }
    return true;
  });

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Stage 6 — low-value residual / identical segment cleanup
// ---------------------------------------------------------------------------

function normalizeSegmentKey(segment: string): string {
  return segment
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.!؟۔…:]+$/g, '');
}

export function dedupeIdenticalSegments(segments: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const segment of segments) {
    const key = normalizeSegmentKey(segment);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(segment);
  }
  return out;
}

/**
 * Isolated brand/model fragments and incomplete stubs are not useful PDP copy.
 * Never invent replacement text — return null so the Description section collapses.
 */
export function isLowValueCustomerDescription(text: string): boolean {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return true;

  const lines = cleaned
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 1) {
    const line = lines[0];
    const wordCount = line.split(/\s+/).filter(Boolean).length;
    const hasSentenceCue =
      /[.!؟۔]|ساخته|دارای|مناسب|شامل|حاوی|با\s+فرمول|برای\s+استفاده/.test(line);
    if (line.length < 12) return true;
    if (
      line.length <= 40 &&
      wordCount <= 5 &&
      !PRODUCT_FACT_SIGNAL.test(line) &&
      !hasSentenceCue
    ) {
      return true;
    }
  }

  return false;
}

export function filterMarketplaceOperationalContent(input: string): string {
  const segments = segmentDescriptionContent(input);
  const kept = keepProductFactSegments(segments);
  const deduped = dedupeIdenticalSegments(kept);
  return deduped.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// Finalize + public builder
// ---------------------------------------------------------------------------

function finalizeCustomerDescription(
  rawPlain: string,
  attributes?: DescriptionAttributeRef[] | null,
): string | null {
  let text = stripImportMachineNoise(rawPlain);
  text = filterMarketplaceOperationalContent(text);
  // Re-join to lines for attribute near-dedup, then re-segment lightly.
  text = omitLinesDuplicatingAttributes(
    text.replace(/\n\n+/g, '\n'),
    attributes,
  );
  text = dedupeIdenticalSegments(segmentDescriptionContent(text)).join('\n\n');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (!text || isLowValueCustomerDescription(text)) return null;
  return text;
}

/**
 * Merge non-deleted description rows (displayOrder ASC) into plain text.
 * Persian-first: prefer translated `content` when it contains Persian script;
 * fall back to sourceContent only when no usable Persian content exists.
 * Avoids dumping both source + translated duplicates.
 */
export function buildStorefrontPdpDescription(
  rows: RawPdpDescription[] | null | undefined,
  productDescription?: string | null,
  productSourceDescription?: string | null,
  attributes?: DescriptionAttributeRef[] | null,
): string | null {
  const active = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.isDeleted !== true)
    .sort(
      (a, b) =>
        (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0) || 0,
    );

  const PERSIAN_RE = /[\u0600-\u06FF]/;
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const row of active) {
    const content = String(row.content || '').trim();
    const source = String(row.sourceContent || '').trim();
    let chosen = '';

    if (content && PERSIAN_RE.test(content)) {
      chosen = content;
    } else if (content && content !== source) {
      // Non-identical translation even without Persian script markers
      chosen = content;
    } else if (content) {
      chosen = content;
    } else if (source) {
      chosen = source;
    }

    if (!chosen) continue;
    const plain = stripHtmlToPlainText(chosen);
    if (!plain) continue;

    const key = plain.toLowerCase();
    const sourceKey = source ? stripHtmlToPlainText(source).toLowerCase() : '';
    // Skip if we already emitted this line or its source twin after a Persian pick
    if (
      seen.has(key) ||
      (sourceKey && seen.has(sourceKey) && key === sourceKey)
    ) {
      continue;
    }
    // If Persian version already present, skip later source-language twin
    if (sourceKey && seen.has(`fa:${sourceKey}`)) {
      continue;
    }
    if (PERSIAN_RE.test(plain) && sourceKey) {
      seen.add(`fa:${sourceKey}`);
    }
    seen.add(key);
    parts.push(plain);
  }

  if (parts.length) {
    return finalizeCustomerDescription(parts.join('\n\n'), attributes);
  }

  const fallback = (
    productDescription ||
    productSourceDescription ||
    ''
  ).trim();
  if (!fallback) return null;
  return finalizeCustomerDescription(
    stripHtmlToPlainText(fallback),
    attributes,
  );
}
