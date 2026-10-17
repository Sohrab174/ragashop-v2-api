/**
 * Category-level gender relevance for the adult gender-review queue.
 *
 * product.gender is unchanged by this module. `unisex` is never inferred.
 * Not-applicable means gender is irrelevant for adult women/men routing.
 * Required and unresolved categories stay reviewable while gender is null.
 *
 * Kids detection uses the source-category root, an explicit full-segment
 * allowlist, the assortment business domain, and the category gender flag.
 * A label that merely contains "bebek" or "çocuk" is not enough.
 *
 * Children's footwear filed under a general shoe category is removed when
 * the title is explicit, or when every usable Beden value is in the
 * children's EU run (all ≤ 35, at least one ≤ 34, none ≥ 36). A distribution
 * that also contains an adult size stays reviewable. Size 35.5 and every
 * size from 36 upward stay reviewable.
 * Children's apparel filed under a general clothing category is removed on
 * the same terms: an explicit title, or a beden value in yaş, months, or
 * newborn, with no adult contradiction. Letter sizes and EU 32–50 stay
 * reviewable. Mixed size systems, mother-daughter sets, and missing
 * evidence stay reviewable. Bebek Yaka and bebek mavi/pembe are not
 * audience evidence. The product ageGroup column and Persian titles are
 * ignored. product.gender is never written here.
 */

export type GenderRelevance =
  | 'gender_required'
  | 'gender_not_applicable'
  | 'gender_unresolved';

export type GenderRelevanceDecision = {
  relevance: GenderRelevance;
  reason: string;
  /** Full explanation for product preview and details. */
  reasonLabel: string;
  /** Short Persian badge for the queue table. */
  reasonBadge: string;
  /** True when a null gender belongs in the adult review queue. */
  reviewable: boolean;
};

export type GenderRelevanceAttribute = {
  name?: string | null;
  sourceName?: string | null;
  value?: string | null;
  valueSource?: string | null;
  /** Color attributes are ignored. They are not age or audience evidence. */
  kind?: string | null;
};

export type GenderRelevanceInput = {
  hierarchy?: string | null;
  businessDomain?: string | null;
  categoryGender?: string | null;
  /**
   * Product signals. `ageGroup` is accepted and deliberately ignored:
   * crawler age-group data is not reliable enough to remove a product.
   */
  name?: string | null;
  sourceName?: string | null;
  ageGroup?: string | null;
  attributes?: GenderRelevanceAttribute[] | null;
};

type Bucket = 'required' | 'not_applicable' | 'ambiguous' | 'kids' | 'unknown';

type Signal = {
  bucket: Bucket;
  reason: string;
  reasonLabel: string;
};

const KIDS_ROOTS = new Set([
  'anne & bebek & çocuk',
  'mother & baby & kids',
]);

/** Full hierarchy segments. Substring matches are intentionally rejected. */
const KIDS_SEGMENTS = new Set([
  'bebek giyim',
  'çocuk giyim',
  'kız çocuk',
  'erkek çocuk',
  'bebek ayakkabı',
  'çocuk ayakkabı',
  'bebek aksesuar',
  'çocuk aksesuar',
  'çocuk gereçleri',
]);

const HOME_ROOTS = new Set(['ev & mobilya', 'home & furniture']);
const ELECTRONICS_ROOTS = new Set(['elektronik', 'electronics']);
const SUPERMARKET_ROOTS = new Set(['süpermarket', 'supermarket']);
const HOBBY_ROOTS = new Set(['hobi & eğlence', 'hobby & entertainment']);
const STATIONERY_ROOTS = new Set([
  'kırtasiye & ofis malzemeleri',
  'stationery & office',
]);
const SPORT_ROOTS = new Set(['spor & outdoor', 'sport & outdoor']);
const APPAREL_ROOTS = new Set(['giyim', 'clothing']);
const SHOE_ROOTS = new Set(['ayakkabı', 'shoes']);
const ACCESSORY_ROOTS = new Set(['aksesuar', 'accessories']);
const COSMETIC_ROOTS = new Set([
  'kozmetik & kişisel bakım',
  'cosmetics & personal care',
]);

const SPORTSWEAR_SEGMENT = 'spor giyim';

/**
 * General-use cosmetics. Gender is not required for catalog routing.
 * Color makeup, nails, skin, and hair stay here. A makeup parent alone
 * does not make a product gender-specific.
 */
const COSMETIC_GENERAL_SEGMENTS = new Set([
  'cilt bakım',
  'skin care',
  'saç bakım',
  'hair care',
  'makyaj aksesuarları',
  'makeup accessories',
  'dudak makyajı',
  'göz makyajı',
  'ten makyajı',
  'lip makeup',
  'eye makeup',
  'face makeup',
  'tırnak',
  'nail',
]);

/** Explicitly gendered grooming. General makeup is not in this set. */
const COSMETIC_SPECIFIC_SEGMENTS = new Set([
  'ıslak tıraş',
  'wet shave',
  'erkek bakım',
  'erkek parfüm',
  'erkek kozmetik',
  'kadın parfüm',
]);

const HOME_DOMAINS = new Set([
  'home_goods_small',
  'home_furniture',
  'home_rugs',
  'home_curtains',
  'home_lighting',
  'home_bulky_utility',
]);

const KIDS_DOMAINS = new Set(['kids_goods_toys']);

const REQUIRED_DOMAINS = new Set(['fashion_apparel', 'fashion_shoes']);

const NOT_APPLICABLE_DOMAINS = new Set(['electronics']);

function normalizeCategoryLabel(value: string | null | undefined): string {
  return String(value || '')
    .toLocaleLowerCase('tr')
    .replace(/\s+/g, ' ')
    .trim();
}

function hierarchySegments(hierarchy: string | null | undefined): string[] {
  return String(hierarchy || '')
    .split('/')
    .map((segment) => normalizeCategoryLabel(segment))
    .filter(Boolean);
}

const REASON_BADGES: Record<string, string> = {
  adult_apparel: 'لباس بدون جنسیت',
  footwear: 'کفش نیازمند بررسی',
  sportswear: 'لباس ورزشی',
  cosmetics_gender_specific: 'آرایش نیازمند بررسی',
  cosmetics_ambiguous: 'آرایش مبهم',
  cosmetics_general: 'آرایش عمومی',
  accessory_ambiguous: 'اکسسوری نیازمند بررسی',
  conflicting_signals: 'اطلاعات متناقض',
  unknown_category: 'دسته نامشخص',
  domain_not_decisive: 'نیازمند بررسی',
  kids_hierarchy: 'کالای کودک',
  kids_domain: 'کالای کودک',
  kids_category_flag: 'کالای کودک',
  kids_footwear: 'کفش کودک',
  kids_apparel: 'لباس کودک',
  household: 'کالای خانگی',
  electronics: 'الکترونیک',
  supermarket: 'سوپرمارکت',
  hobby: 'سرگرمی',
  stationery: 'لوازم‌التحریر',
  sport_equipment: 'تجهیزات ورزشی',
  already_assigned: 'تعیین‌شده',
};

function decision(
  relevance: GenderRelevance,
  reason: string,
  reasonLabel: string,
): GenderRelevanceDecision {
  return {
    relevance,
    reason,
    reasonLabel,
    reasonBadge: REASON_BADGES[reason] ?? 'نیازمند بررسی',
    reviewable: relevance !== 'gender_not_applicable',
  };
}

function fromBucket(signal: Signal): GenderRelevanceDecision {
  if (signal.bucket === 'kids' || signal.bucket === 'not_applicable') {
    return decision('gender_not_applicable', signal.reason, signal.reasonLabel);
  }
  if (signal.bucket === 'required') {
    return decision('gender_required', signal.reason, signal.reasonLabel);
  }
  return decision(
    'gender_unresolved',
    signal.reason,
    signal.reasonLabel,
  );
}

function hierarchySignal(segments: string[]): Signal {
  if (!segments.length) {
    return {
      bucket: 'unknown',
      reason: 'unknown_category',
      reasonLabel: 'دسته منبع سلسله‌مراتب ندارد',
    };
  }
  const root = segments[0];
  const segmentSet = new Set(segments);

  if (KIDS_ROOTS.has(root) || [...segmentSet].some((segment) => KIDS_SEGMENTS.has(segment))) {
    return {
      bucket: 'kids',
      reason: 'kids_hierarchy',
      reasonLabel: 'دسته کودک یا نوزاد است و در صف جنسیت بزرگسال قرار نمی‌گیرد',
    };
  }
  if (HOME_ROOTS.has(root)) {
    return {
      bucket: 'not_applicable',
      reason: 'household',
      reasonLabel: 'کالای خانگی است و جنسیت برای آن موضوعیت ندارد',
    };
  }
  if (ELECTRONICS_ROOTS.has(root)) {
    return {
      bucket: 'not_applicable',
      reason: 'electronics',
      reasonLabel: 'کالای الکترونیک است و جنسیت برای آن موضوعیت ندارد',
    };
  }
  if (SUPERMARKET_ROOTS.has(root)) {
    return {
      bucket: 'not_applicable',
      reason: 'supermarket',
      reasonLabel: 'کالای سوپرمارکتی است و جنسیت برای آن موضوعیت ندارد',
    };
  }
  if (HOBBY_ROOTS.has(root)) {
    return {
      bucket: 'not_applicable',
      reason: 'hobby',
      reasonLabel: 'کالای سرگرمی است و جنسیت برای آن موضوعیت ندارد',
    };
  }
  if (STATIONERY_ROOTS.has(root)) {
    return {
      bucket: 'not_applicable',
      reason: 'stationery',
      reasonLabel: 'لوازم‌التحریر است و جنسیت برای آن موضوعیت ندارد',
    };
  }
  if (COSMETIC_ROOTS.has(root)) {
    const specific = segments.some((segment) =>
      COSMETIC_SPECIFIC_SEGMENTS.has(segment),
    );
    const general = segments.some((segment) =>
      COSMETIC_GENERAL_SEGMENTS.has(segment),
    );
    if (specific && general) {
      return {
        bucket: 'ambiguous',
        reason: 'conflicting_signals',
        reasonLabel: 'شاخه‌های آرایشی این دسته با هم نمی‌خوانند',
      };
    }
    if (specific) {
      return {
        bucket: 'required',
        reason: 'cosmetics_gender_specific',
        reasonLabel: 'آرایشی جنسیت‌دار است و جنسیت آن مشخص نیست',
      };
    }
    if (general) {
      return {
        bucket: 'not_applicable',
        reason: 'cosmetics_general',
        reasonLabel: 'آرایشی عمومی است و جنسیت برای آن موضوعیت ندارد',
      };
    }
    return {
      bucket: 'ambiguous',
      reason: 'cosmetics_ambiguous',
      reasonLabel: 'دسته آرایشی مبهم است و نیاز به بررسی دارد',
    };
  }
  if (SPORT_ROOTS.has(root)) {
    if (segmentSet.has(SPORTSWEAR_SEGMENT)) {
      return {
        bucket: 'required',
        reason: 'sportswear',
        reasonLabel: 'پوشاک ورزشی است و جنسیت آن مشخص نیست',
      };
    }
    return {
      bucket: 'not_applicable',
      reason: 'sport_equipment',
      reasonLabel: 'تجهیزات ورزشی است و جنسیت برای آن موضوعیت ندارد',
    };
  }
  if (segmentSet.has(SPORTSWEAR_SEGMENT) && APPAREL_ROOTS.has(root)) {
    return {
      bucket: 'required',
      reason: 'sportswear',
      reasonLabel: 'پوشاک ورزشی است و جنسیت آن مشخص نیست',
    };
  }
  if (APPAREL_ROOTS.has(root)) {
    return {
      bucket: 'required',
      reason: 'adult_apparel',
      reasonLabel: 'پوشاک بزرگسال است و جنسیت آن مشخص نیست',
    };
  }
  if (SHOE_ROOTS.has(root)) {
    return {
      bucket: 'required',
      reason: 'footwear',
      reasonLabel: 'کفش است و جنسیت آن مشخص نیست',
    };
  }
  if (ACCESSORY_ROOTS.has(root)) {
    return {
      bucket: 'ambiguous',
      reason: 'accessory_ambiguous',
      reasonLabel: 'اکسسوری است و جنسیت آن نیاز به بررسی دارد',
    };
  }
  return {
    bucket: 'unknown',
    reason: 'unknown_category',
    reasonLabel: 'دسته منبع شناخته‌شده نیست',
  };
}

function domainSignal(businessDomain: string | null | undefined): Signal {
  const domain = normalizeCategoryLabel(businessDomain).replace(/ /g, '_');
  const raw = String(businessDomain || '').trim();
  if (!raw) {
    return {
      bucket: 'unknown',
      reason: 'unknown_category',
      reasonLabel: 'حوزه تجاری دسته ثبت نشده است',
    };
  }
  if (KIDS_DOMAINS.has(raw)) {
    return {
      bucket: 'kids',
      reason: 'kids_domain',
      reasonLabel: 'حوزه کالای کودک است و در صف جنسیت بزرگسال قرار نمی‌گیرد',
    };
  }
  if (HOME_DOMAINS.has(raw)) {
    return {
      bucket: 'not_applicable',
      reason: 'household',
      reasonLabel: 'کالای خانگی است و جنسیت برای آن موضوعیت ندارد',
    };
  }
  if (NOT_APPLICABLE_DOMAINS.has(raw)) {
    return {
      bucket: 'not_applicable',
      reason: 'electronics',
      reasonLabel: 'کالای الکترونیک است و جنسیت برای آن موضوعیت ندارد',
    };
  }
  if (raw === 'fashion_shoes') {
    return {
      bucket: 'required',
      reason: 'footwear',
      reasonLabel: 'کفش است و جنسیت آن مشخص نیست',
    };
  }
  if (REQUIRED_DOMAINS.has(raw)) {
    return {
      bucket: 'required',
      reason: 'adult_apparel',
      reasonLabel: 'پوشاک بزرگسال است و جنسیت آن مشخص نیست',
    };
  }
  if (
    raw === 'sport' ||
    raw === 'sport_bulky' ||
    raw === 'beauty' ||
    raw === 'fashion_accessories_bags' ||
    raw === 'sensitive'
  ) {
    return {
      bucket: 'ambiguous',
      reason: 'domain_not_decisive',
      reasonLabel: 'حوزه تجاری به‌تنهایی جنسیت را مشخص نمی‌کند',
    };
  }
  if (domain === 'unknown' || raw === 'other') {
    return {
      bucket: 'unknown',
      reason: 'unknown_category',
      reasonLabel: 'حوزه تجاری دسته نامشخص است',
    };
  }
  return {
    bucket: 'unknown',
    reason: 'unknown_category',
    reasonLabel: 'حوزه تجاری دسته شناخته‌شده نیست',
  };
}

function opposite(left: Bucket, right: Bucket): boolean {
  const decisive = new Set(['required', 'not_applicable', 'kids']);
  if (!decisive.has(left) || !decisive.has(right)) return false;
  return left !== right;
}

function classifyCategoryGenderRelevance(
  input: GenderRelevanceInput,
): GenderRelevanceDecision {
  const segments = hierarchySegments(input.hierarchy);
  const hierarchy = hierarchySignal(segments);
  const domain = domainSignal(input.businessDomain);
  const categoryGender = normalizeCategoryLabel(input.categoryGender);

  if (hierarchy.bucket === 'kids') {
    return fromBucket(hierarchy);
  }

  if (
    categoryGender === 'child' &&
    (hierarchy.bucket === 'required' || hierarchy.bucket === 'ambiguous')
  ) {
    return decision(
      'gender_unresolved',
      'conflicting_signals',
      'پرچم کودک با مسیر پوشاک بزرگسال نمی‌خواند',
    );
  }

  if (opposite(hierarchy.bucket, domain.bucket)) {
    return decision(
      'gender_unresolved',
      'conflicting_signals',
      'سلسله‌مراتب و حوزه تجاری دسته با هم نمی‌خوانند',
    );
  }

  if (hierarchy.bucket === 'unknown' && domain.bucket === 'kids') {
    return fromBucket(domain);
  }
  if (categoryGender === 'child' && hierarchy.bucket !== 'required') {
    return decision(
      'gender_not_applicable',
      'kids_category_flag',
      'دسته با پرچم کودک ثبت شده و در صف جنسیت بزرگسال قرار نمی‌گیرد',
    );
  }
  if (hierarchy.bucket !== 'unknown') {
    return fromBucket(hierarchy);
  }
  if (domain.bucket !== 'unknown') {
    return fromBucket(domain);
  }
  return decision(
    'gender_unresolved',
    'unknown_category',
    'دسته منبع برای تعیین جنسیت کافی نیست',
  );
}

/**
 * Fold Turkish letters so audience phrases match dotted and dotless i,
 * and ASCII spellings such as "cocuk".
 */
function foldTr(value: string | null | undefined): string {
  return normalizeCategoryLabel(value)
    .replace(/ı/g, 'i')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u');
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${word}(?:$|[^a-z0-9])`).test(text);
}

function kidsSizeRange(text: string): boolean {
  const match = text.match(
    /(?:^|[^0-9])(1[8-9]|2[0-9]|3[0-5])\s*-\s*(1[8-9]|2[0-9]|3[0-5])\s*numara(?:$|[^a-z])/,
  );
  return Boolean(match);
}

function titleIndicatesChildFootwear(text: string): boolean {
  // The caller already knows the category is footwear, so an explicit
  // audience word is a second signal. "bebek" is not one of these:
  // it is also a color and a collar name.
  if (hasWord(text, 'cocuk') || hasWord(text, 'kids')) return true;
  if (/(?:^|[^a-z])(kiz|erkek|unisex) cocuk(?:$|[^a-z])/.test(text)) return true;
  if (text.includes('kiz bebe')) return true;
  if (
    text.includes('okul oncesi') ||
    text.includes('ilk adim') ||
    text.includes('ilkadim')
  ) {
    return true;
  }
  if (/\(\s*(gs|ps|td)\s*\)/.test(text)) return true;
  if (
    hasWord(text, 'gs') ||
    hasWord(text, 'ps') ||
    hasWord(text, 'td') ||
    hasWord(text, 'inf') ||
    hasWord(text, 'crib') ||
    text.includes('cf i')
  ) {
    return true;
  }
  if (kidsSizeRange(text)) return true;
  const bebekStyle = /bebek (yaka|mavi|mavisi|pembe|pembesi)/.test(text);
  const bebekShoe =
    hasWord(text, 'bebek') &&
    (text.includes('ayakkabi') ||
      text.includes('sandalet') ||
      text.includes('sneaker') ||
      hasWord(text, 'patik') ||
      hasWord(text, 'cocuk'));
  if (bebekShoe && !bebekStyle) return true;
  return false;
}

/** Women and adult markers. "Erkek" in a kids shoe title is the boys' line. */
function hasAdultMarker(text: string): boolean {
  return hasWord(text, 'kadin') || hasWord(text, 'bayan') || hasWord(text, 'yetiskin');
}

function attributesIndicateChild(
  attributes: GenderRelevanceAttribute[] | null | undefined,
): boolean {
  for (const attr of attributes || []) {
    if (foldTr(attr.kind) === 'color') continue;
    const name = foldTr(`${attr.name || ''} ${attr.sourceName || ''}`);
    const value = foldTr(`${attr.value || ''} ${attr.valueSource || ''}`);
    const ageNamed =
      hasWord(name, 'yas') || hasWord(name, 'age') || name.includes('yas grubu');
    if (
      ageNamed &&
      (hasWord(value, 'cocuk') ||
        hasWord(value, 'bebek') ||
        hasWord(value, 'child') ||
        hasWord(value, 'baby'))
    ) {
      return true;
    }
    const sizeNamed =
      name.includes('numara') ||
      name.includes('shoe size') ||
      name.includes('ayakkabi numar');
    if (sizeNamed && kidsSizeRange(value)) return true;
  }
  return false;
}

const IGNORED_BEDEN_VALUES = new Set(['', 'standart', 'tek ebat']);

function isBedenAttribute(attr: GenderRelevanceAttribute): boolean {
  if (foldTr(attr.kind) === 'color') return false;
  const name = foldTr(`${attr.name || ''} ${attr.sourceName || ''}`);
  return hasWord(name, 'beden');
}

/** Keep EU footwear sizes. Values outside 18–50 are data errors, not evidence. */
function acceptEuSize(value: number, sizes: number[]): void {
  if (value >= 18 && value <= 50) sizes.push(value);
}

function collectBedenToken(text: string, sizes: number[]): void {
  if (IGNORED_BEDEN_VALUES.has(text)) return;
  const normalized = text.replace(/,/g, '.');
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    acceptEuSize(Number(normalized), sizes);
    return;
  }
  const range = normalized.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (range) {
    acceptEuSize(Number(range[1]), sizes);
    acceptEuSize(Number(range[2]), sizes);
    return;
  }
  const fraction = normalized.match(/^(\d+)\s+\d+\/\d+$/);
  if (fraction) {
    acceptEuSize(Number(fraction[1]), sizes);
    return;
  }
  const inches = normalized.match(/^(\d+)"$/);
  if (inches) acceptEuSize(Number(inches[1]), sizes);
}

/**
 * Usable EU sizes from every Beden variant. Non-size words and invalid
 * numbers are dropped. Persian text does not parse as a size.
 */
function usableBedenSizes(
  attributes: GenderRelevanceAttribute[] | null | undefined,
): number[] {
  const sizes: number[] = [];
  for (const attr of attributes || []) {
    if (!isBedenAttribute(attr)) continue;
    const seen = new Set<string>();
    for (const raw of [attr.value, attr.valueSource]) {
      const text = foldTr(raw);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      collectBedenToken(text, sizes);
    }
  }
  return [...new Set(sizes)];
}

/**
 * `child` is a unanimous children's run. `mixed` contains both a size ≤ 34
 * and a size ≥ 36. Small adult runs (35.5, 36+) are `none`.
 */
function bedenFootwearDistribution(
  attributes: GenderRelevanceAttribute[] | null | undefined,
): 'child' | 'mixed' | 'none' {
  const sizes = usableBedenSizes(attributes);
  if (!sizes.length) return 'none';
  if (sizes.every((size) => size <= 35) && sizes.some((size) => size <= 34)) {
    return 'child';
  }
  if (sizes.some((size) => size <= 34) && sizes.some((size) => size >= 36)) {
    return 'mixed';
  }
  return 'none';
}

function attributesIndicateAdult(
  attributes: GenderRelevanceAttribute[] | null | undefined,
): boolean {
  for (const attr of attributes || []) {
    if (foldTr(attr.kind) === 'color') continue;
    const name = foldTr(`${attr.name || ''} ${attr.sourceName || ''}`);
    if (!(hasWord(name, 'yas') || hasWord(name, 'age') || name.includes('cinsiyet'))) {
      continue;
    }
    const value = foldTr(`${attr.value || ''} ${attr.valueSource || ''}`);
    if (hasAdultMarker(value) && !hasWord(value, 'cocuk')) return true;
  }
  return false;
}

const ADULT_APPAREL_SIZES = new Set([
  'xxs',
  'xs',
  's',
  'm',
  'l',
  'xl',
  'xxl',
  '2xs',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
  's/m',
  'l/xl',
  'xs/s',
  'xl/2xl',
  'm/l',
  '2xl-3xl',
  '2xl/3xl',
  'xs-s',
  'xl/l',
  'm/xl',
  's/s',
]);

function isAdultApparelSize(value: string): boolean {
  return ADULT_APPAREL_SIZES.has(value) || /^(3[2-9]|4[0-9]|50)$/.test(value);
}

function isChildApparelSize(value: string): boolean {
  if (!value || value === 'standart') return false;
  if (/yas|yeni\s*dogan|^newborn$|month/.test(value)) return true;
  return /(^|[^a-z])\d+\s*(-\s*\d+\s*)?ay($|[^a-z])/.test(value);
}

/**
 * Explicit baby/child wording. Collar and baby-blue / baby-pink phrases
 * are removed first so they cannot confirm a children's product.
 */
function titleIndicatesChildApparel(text: string): boolean {
  if (/cocuk/.test(text)) return true;
  if (hasWord(text, 'kids') || hasWord(text, 'baby')) return true;
  if (/yenidogan|yeni dogan/.test(text) || hasWord(text, 'newborn')) return true;
  if (/\d+\s*(-\s*\d+\s*)?yas/.test(text)) return true;
  if (/\d+\s*(-\s*\d+\s*)?(ay|aylik)\b/.test(text)) return true;
  if (hasWord(text, 'patikli')) return true;
  const stripped = text
    .replace(/bebek yaka/g, ' ')
    .replace(/bebe yaka/g, ' ')
    .replace(/bebek mavi(si)?/g, ' ')
    .replace(/bebek pembe(si)?/g, ' ');
  return /(?:^|[^a-z0-9])bebek/.test(stripped);
}

function isMotherDaughterTitle(text: string): boolean {
  return /anne kiz|anne ve kiz|anne-kiz/.test(text);
}

function bedenTexts(
  attributes: GenderRelevanceAttribute[] | null | undefined,
): string[] {
  const texts: string[] = [];
  for (const attr of attributes || []) {
    if (foldTr(attr.kind) === 'color') continue;
    const name = foldTr(`${attr.name || ''} ${attr.sourceName || ''}`);
    if (!hasWord(name, 'beden')) continue;
    const value = foldTr(attr.value);
    const source = foldTr(attr.valueSource);
    if (value) texts.push(value);
    if (source && source !== value) texts.push(source);
  }
  return texts;
}

/**
 * General apparel stays reviewable unless the title or beden values show
 * children's or newborn clothing without an adult contradiction.
 * `ageGroup` is ignored on purpose. Persian text is not a signal.
 */
function refineAdultApparel(
  category: GenderRelevanceDecision,
  product?: GenderRelevanceInput | null,
): GenderRelevanceDecision {
  const text = foldTr(`${product?.sourceName || ''} ${product?.name || ''}`);
  const sizes = bedenTexts(product?.attributes);
  const childTitle = titleIndicatesChildApparel(text);
  const adultTitle = hasAdultMarker(text);
  const childSize = sizes.some(isChildApparelSize);
  const adultSize = sizes.some(isAdultApparelSize);
  if (
    isMotherDaughterTitle(text) ||
    (childTitle && adultTitle) ||
    (!childTitle && childSize && (adultSize || adultTitle))
  ) {
    return decision(
      'gender_unresolved',
      'conflicting_signals',
      isMotherDaughterTitle(text)
        ? 'ست مادر و دختر است و باید در صف بررسی بماند'
        : 'عنوان یا اندازه لباس هم نشانه کودک و هم نشانه بزرگسال دارد',
    );
  }
  if (childTitle || (childSize && !adultSize)) {
    return decision(
      'gender_not_applicable',
      'kids_apparel',
      'عنوان یا اندازه نشان می‌دهد این لباس کودک یا نوزاد است و در صف جنسیت بزرگسال قرار نمی‌گیرد',
    );
  }
  return category;
}

/**
 * Footwear and apparel stay reviewable unless title terminology and reliable
 * size/age attributes agree that the product is for children.
 * `ageGroup` is ignored on purpose. product.gender is never written here.
 */
export function refineGenderRelevance(
  category: GenderRelevanceDecision,
  product?: GenderRelevanceInput | null,
): GenderRelevanceDecision {
  if (
    category.reason === 'adult_apparel' &&
    category.relevance === 'gender_required'
  ) {
    return refineAdultApparel(category, product);
  }
  if (category.reason !== 'footwear' || category.relevance !== 'gender_required') {
    return category;
  }
  const text = foldTr(`${product?.sourceName || ''} ${product?.name || ''}`);
  const child =
    titleIndicatesChildFootwear(text) ||
    attributesIndicateChild(product?.attributes);
  const adult = hasAdultMarker(text) || attributesIndicateAdult(product?.attributes);
  const shoeConflict = decision(
    'gender_unresolved',
    'conflicting_signals',
    'عنوان یا ویژگی کفش هم نشانه کودک و هم نشانه بزرگسال دارد',
  );
  if (child && adult) return shoeConflict;
  if (child) {
    return decision(
      'gender_not_applicable',
      'kids_footwear',
      'عنوان یا اندازه نشان می‌دهد این کفش کودک است و در صف جنسیت بزرگسال قرار نمی‌گیرد',
    );
  }
  const beden = bedenFootwearDistribution(product?.attributes);
  if (beden === 'child' && adult) return shoeConflict;
  if (beden === 'child') {
    return decision(
      'gender_not_applicable',
      'kids_footwear',
      'عنوان یا اندازه نشان می‌دهد این کفش کودک است و در صف جنسیت بزرگسال قرار نمی‌گیرد',
    );
  }
  if (beden === 'mixed') return shoeConflict;
  return category;
}

export function classifyGenderRelevance(
  input: GenderRelevanceInput,
): GenderRelevanceDecision {
  return refineGenderRelevance(classifyCategoryGenderRelevance(input), input);
}
