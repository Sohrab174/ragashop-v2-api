/**
 * AUTO-MAP-0 — deterministic category auto-mapping DRY-RUN matcher.
 *
 * Pure functions only: no I/O, no AI, no persistence. Given a source taxonomy
 * node, its discoverable product distribution and the canonical tree, it
 * proposes mapping rules with an explainable tier + reason codes.
 * Nothing here writes mappings; proposals are analysis output only.
 */

export const AUTO_MAP_ENGINE_VERSION = 'auto-map-0.dry-run.1';

/**
 * Thresholds. oppositeNoise / matchSafe mirror CAT-MAP-V2-A; the rest were
 * chosen from the observed local distributions (see AUTO-MAP-0 report).
 */
export const AUTO_MAP_THRESHOLDS = {
  oppositeNoise: 0.02,
  adultNullGenderMax: 0.05,
  minorContaminationMax: 0.05,
  descendantDomainAgreementMin: 0.9,
  kidsRemainderMax: 0.25,
  kidsOwnMin: 0.9,
  titleAgreementMin: 0.9,
  titleMinSample: 20,
  highImpact: 500,
} as const;

export type AutoMapDomain =
  | 'clothing'
  | 'shoe'
  | 'accessory'
  | 'beauty'
  | 'electronics'
  | 'sport'
  | 'sportswear'
  | 'home'
  | 'kids_goods'
  | 'hobby'
  | 'supermarket'
  | 'stationery'
  | 'unknown';

export type AutoMapAudience = 'women' | 'men' | 'kids' | 'neutral';

export type AutoMapTier =
  | 'AUTO_MAP_HIGH_CONFIDENCE'
  | 'AUTO_SUGGEST_REVIEW'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'DATA_QUALITY_BLOCKED'
  | 'NO_DESTINATION';

export const TIER_ORDER: AutoMapTier[] = [
  'AUTO_MAP_HIGH_CONFIDENCE',
  'AUTO_SUGGEST_REVIEW',
  'HUMAN_REVIEW_REQUIRED',
  'DATA_QUALITY_BLOCKED',
  'NO_DESTINATION',
];

// ─── Turkish provider lexicon ────────────────────────────────────────────────

type LexEntry = { re: RegExp; concept: string; approx?: boolean };

/** Order matters: first match wins. Labels are tr-lowercased. */
const CLOTHING_LEX: LexEntry[] = [
  { re: /fantezi/, concept: 'lingerie' },
  { re: /takım elbise/, concept: 'suit' },
  { re: /abiye|mezuniyet|evening|prom dress/, concept: 'evening_dress' },
  { re: /bebek|hastane çıkışı|zıbın/, concept: 'baby_clothing' },
  { re: /alt\s*-\s*üst|tesettür takım/, concept: 'outfit_set' },
  { re: /ferace|kap & ferace/, concept: 'ferace', approx: true },
  { re: /spor tayt|tayt/, concept: 'leggings', approx: true },
  { re: /eşofman/, concept: 'tracksuit', approx: true },
  { re: /bluz|tunik/, concept: 'blouse' },
  { re: /büstiyer|\bbody\b/, concept: 'top_other', approx: true },
  { re: /sweatshirt/, concept: 'sweatshirt' },
  { re: /t-shirt|\btshirts?\b/, concept: 'tshirt' },
  { re: /gömlek|\bshirts?\b/, concept: 'shirt' },
  { re: /\bjeans?\b|kot pantolon/, concept: 'jeans' },
  { re: /pantolon|trousers/, concept: 'pants' },
  { re: /deniz şortu|mayo|bikini|pareo|plaj giyim/, concept: 'swimwear' },
  { re: /plaj havlusu/, concept: 'beach_towel' },
  { re: /şort|bermuda|kapri/, concept: 'shorts' },
  { re: /etek/, concept: 'skirt' },
  { re: /kazak|hırka|süveter/, concept: 'knitwear' },
  {
    re: /mont|kaban|palto|parka|trençkot|trench|pardesü|pardösü|yağmurluk|rüzgarlık|ceket/,
    concept: 'outerwear',
  },
  { re: /yelek/, concept: 'vest', approx: true },
  { re: /polar|softshell/, concept: 'fleece', approx: true },
  { re: /uyku tulumu/, concept: 'baby_clothing' },
  { re: /tulum|salopet/, concept: 'jumpsuit' },
  {
    re: /pijama|pajama|gecelik|sabahlık|ev giyim|babydoll/,
    concept: 'loungewear',
  },
  {
    re: /külot|boxer|sütyen|korse|kombinezon|jartiyer|atlet|fanila|\bslip\b|içlik|termal|iç çamaşırı|iç giyim/,
    concept: 'underwear',
  },
  { re: /çorap/, concept: 'socks' },
  { re: /elbise|\bdress\b/, concept: 'dress' },
];

const SHOE_LEX: LexEntry[] = [
  { re: /bağcı/, concept: 'shoe_care' },
  { re: /topuklu|abiye ayakkabı/, concept: 'heels' },
  {
    re: /ev terliği|ev botu|panduf|patik/,
    concept: 'house_slipper',
    approx: true,
  },
  {
    re: /sneaker|koşu|yürüyüş|halı saha|krampon|outdoor ayakkabı|fitness|antrenman|antreman|basketbol|voleybol|spor ayakkabı/,
    concept: 'sneaker',
  },
  { re: /\bbot\b|çizme|bootie|kar botu/, concept: 'boots' },
  { re: /sandalet|terlik|deniz ayakkabısı/, concept: 'sandal_slipper' },
  {
    re: /loafer|casual|klasik ayakkabı|babet|ballerina|günlük ayakkabı/,
    concept: 'casual_shoe',
  },
];

const ACCESSORY_LEX: LexEntry[] = [
  { re: /fantezi/, concept: 'lingerie' },
  { re: /bebek bakım/, concept: 'kids_goods' },
  { re: /beslenme/, concept: 'lunch_bag' },
  { re: /çanta aksesuar/, concept: 'bag_accessory', approx: true },
  { re: /valiz|bavul/, concept: 'luggage', approx: true },
  { re: /cüzdan|kartlık/, concept: 'wallet' },
  { re: /çanta|clutch|portföy/, concept: 'bag' },
  { re: /akıllı saat|akıllı bileklik/, concept: 'wearable' },
  { re: /saat/, concept: 'watch' },
  { re: /gözlük/, concept: 'eyewear' },
  { re: /kravat|papyon|kol düğmesi/, concept: 'tie', approx: true },
  { re: /kemer|pantolon askısı/, concept: 'belt', approx: true },
  { re: /şemsiye/, concept: 'umbrella', approx: true },
  {
    re: /saç|toka|(^|[^\p{L}])taç([^\p{L}]|$)|peruk/u,
    concept: 'hair_accessory',
    approx: true,
  },
  {
    re: /şapka|bere|atkı|şal|fular|eşarp|boyunluk/,
    concept: 'hat_scarf',
  },
  { re: /eldiven/, concept: 'gloves', approx: true },
  { re: /diğer aksesuar/, concept: 'accessory_other', approx: true },
  {
    re: /bileklik|yüzük|kolye|küpe|piercing|halhal|bilezik|broş|şahmeran|takı|mücevher|vücut aksesuar|çelik set/,
    concept: 'jewelry',
  },
];

const BEAUTY_LEX: LexEntry[] = [
  { re: /tıraş|ağda|epilasyon/, concept: 'shaving' },
  {
    re: /makyaj çantası|kirpik kıvırıcı|makyaj aksesuar/,
    concept: 'makeup_accessory',
    approx: true,
  },
  { re: /ruj|dudak/, concept: 'lip' },
  {
    re: /eyeliner|göz farı|maskara|göz kalemi|kaş|göz makyajı/,
    concept: 'eye_makeup',
  },
  {
    re: /fondöten|kapatıcı|allık|pudra|bb ve cc|bb cc|kontür|aydınlatıcı|makyaj bazı|ten makyajı/,
    concept: 'face_makeup',
  },
  { re: /oje|tırnak/, concept: 'nail' },
  { re: /makyaj/, concept: 'makeup' },
  { re: /saç|hair/, concept: 'haircare' },
  { re: /banyo lifi|süngeri|duş/, concept: 'skincare', approx: true },
  { re: /cilt|yüz|tonik|güneş|dermaroller/, concept: 'skincare' },
  { re: /^kozmetik/, concept: 'beauty_root' },
];

const ELECTRONICS_LEX: LexEntry[] = [
  { re: /tıraş/, concept: 'shaving' },
  { re: /yüz temizleme/, concept: 'skincare', approx: true },
  { re: /bluetooth kulaklık|tws/, concept: 'headphone_bt' },
  { re: /kulaklık/, concept: 'headphone' },
  { re: /telefon/, concept: 'phone' },
  { re: /bilgisayar|tablet/, concept: 'computer' },
  { re: /giyilebilir|akıllı saat|akıllı bileklik/, concept: 'wearable' },
  { re: /konsol|gamepad|joystick|playstation|oyun/, concept: 'gaming' },
  { re: /kamera/, concept: 'camera' },
  { re: /^elektronik$/, concept: 'electronics_root' },
];

const SPORT_LEX: LexEntry[] = [
  { re: /^spor outdoor$/, concept: 'sport_root' },
  { re: /spor giyim/, concept: 'sportswear' },
  { re: /elektrikli bisiklet|bisiklet/, concept: 'bicycle' },
  { re: /pilates|yoga|fitness|kondisyon/, concept: 'fitness' },
  { re: /kamp|çadır|outdoor/, concept: 'outdoor' },
  { re: /^spor aletleri$/, concept: 'sport_equipment' },
  {
    re: /sporcu|bandı|bileklik|koruyucu|kaleci eldiveni|boks eldiveni|dizlik/,
    concept: 'sport_accessory',
  },
  {
    re: /dalış|palet|\bbone\b|deniz gözlüğü|paten|kaykay|kızak|kayak/,
    concept: 'sport_gear',
    approx: true,
  },
];

const DOMAIN_LEX: Record<AutoMapDomain, LexEntry[]> = {
  clothing: CLOTHING_LEX,
  shoe: SHOE_LEX,
  accessory: ACCESSORY_LEX,
  beauty: BEAUTY_LEX,
  electronics: ELECTRONICS_LEX,
  sport: SPORT_LEX,
  sportswear: [{ re: /./, concept: 'sportswear' }],
  home: [{ re: /./, concept: 'home' }],
  kids_goods: [{ re: /./, concept: 'kids_goods' }],
  hobby: [{ re: /./, concept: 'hobby' }],
  supermarket: [{ re: /./, concept: 'supermarket' }],
  stationery: [{ re: /./, concept: 'stationery' }],
  unknown: [],
};

/** Group-level concepts on non-leaf provider nodes (sourceName only). */
const GROUP_LEX: Array<{ re: RegExp; concept: string }> = [
  { re: /^aksesuar$/, concept: 'accessory_group' },
  { re: /^giyim$/, concept: 'clothing_group' },
  { re: /^ayakkabı$/, concept: 'shoe_group' },
];

/** Approximate concept → nearest destination concept (caps tier at review). */
export const CONCEPT_FALLBACK: Record<string, string> = {
  ferace: 'outerwear',
  leggings: 'sportswear',
  tracksuit: 'sportswear',
  top_other: 'blouse',
  vest: 'outerwear',
  fleece: 'sweatshirt',
  house_slipper: 'sandal_slipper',
  bag_accessory: 'bag',
  luggage: 'bag',
  tie: 'accessory_group',
  belt: 'accessory_group',
  umbrella: 'accessory_group',
  hair_accessory: 'accessory_group',
  accessory_other: 'accessory_group',
  gloves: 'hat_scarf',
  makeup_accessory: 'makeup',
  sport_gear: 'sport_accessory',
};

/** Concepts that are inherently women-only (product-gender contradiction check). */
const FEMALE_ONLY_CONCEPTS = new Set([
  'skirt',
  'heels',
  'blouse',
  'evening_dress',
  'dress',
]);
const MALE_ONLY_CONCEPTS = new Set(['suit', 'tie']);

export function trLower(value: string | null | undefined): string {
  return String(value || '')
    .toLocaleLowerCase('tr')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchLexicon(
  label: string | null | undefined,
  lex: LexEntry[],
): { concept: string; approx: boolean } | null {
  const text = trLower(label);
  if (!text) return null;
  for (const entry of lex) {
    if (entry.re.test(text)) {
      return { concept: entry.concept, approx: entry.approx === true };
    }
  }
  return null;
}

/** Free-text label (e.g. a product title) → concept within a domain lexicon. */
export function matchDomainConcept(
  label: string | null | undefined,
  domain: AutoMapDomain,
): string | null {
  return matchLexicon(label, DOMAIN_LEX[domain] || [])?.concept ?? null;
}

export function labelMatchesConcept(
  label: string | null | undefined,
  concept: string,
  domain: AutoMapDomain,
): boolean {
  const text = trLower(label);
  if (!text) return false;
  return (DOMAIN_LEX[domain] || []).some(
    (e) => e.concept === concept && e.re.test(text),
  );
}

// ─── Domain resolution ───────────────────────────────────────────────────────

const HIERARCHY_ROOT_DOMAIN: Record<string, AutoMapDomain> = {
  giyim: 'clothing',
  clothing: 'clothing',
  ayakkabı: 'shoe',
  shoes: 'shoe',
  aksesuar: 'accessory',
  'kozmetik & kişisel bakım': 'beauty',
  'cosmetics & personal care': 'beauty',
  elektronik: 'electronics',
  'spor & outdoor': 'sport',
  'ev & mobilya': 'home',
  'anne & bebek & çocuk': 'kids_goods',
  'hobi & eğlence': 'hobby',
  süpermarket: 'supermarket',
  supermarket: 'supermarket',
  'kırtasiye & ofis malzemeleri': 'stationery',
};

const PATH_ROOT_DOMAIN: Record<string, AutoMapDomain> = {
  giyim: 'clothing',
  ayakkabı: 'shoe',
  aksesuar: 'accessory',
  kozmetik: 'beauty',
  elektronik: 'electronics',
  'spor outdoor': 'sport',
  'ev ve mobilya': 'home',
  'anne & bebek & çocuk': 'kids_goods',
  hobi: 'hobby',
  süpermarket: 'supermarket',
};

const BANK_TYPE_DOMAIN: Record<string, AutoMapDomain> = {
  CLOTHING: 'clothing',
  SHOE: 'shoe',
  ACCESSORY: 'accessory',
  GOLD: 'accessory',
  COSMETICS_AND_PERSONAL_CARE: 'beauty',
  ELECTRONIC: 'electronics',
  MOBILE_PHONE: 'electronics',
  WEARABLE_TECHNOLOGY: 'electronics',
  GAME_AND_GAME_CONSOLES: 'electronics',
  SMALL_HOME_APPLIACES: 'electronics',
  HOME_AND_LIVING: 'home',
  FURNITURE: 'home',
  MOTHER_BABBY_CHILD: 'kids_goods',
  SUPER_MARKET: 'supermarket',
};

export type SourceNodeInput = {
  id: number;
  parentId: number | null;
  source: string | null;
  sourceName: string | null;
  name: string | null;
  hierarchy: string | null;
  bankTypeName: string | null;
  gender: string | null;
  status: string;
};

export function hierarchySegments(hierarchy: string | null): string[] {
  return String(hierarchy || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resolveDomain(
  node: SourceNodeInput,
  pathRootSourceName: string | null,
): { domain: AutoMapDomain; via: 'hierarchy' | 'bankType' | 'path' | 'none' } {
  const segs = hierarchySegments(node.hierarchy).map(trLower);
  if (segs.length) {
    const root = HIERARCHY_ROOT_DOMAIN[segs[0]];
    if (root === 'sport' && segs[1] === 'spor giyim') {
      return { domain: 'sportswear', via: 'hierarchy' };
    }
    if (root === 'clothing' && segs[1] === 'spor giyim') {
      return { domain: 'sportswear', via: 'hierarchy' };
    }
    if (root) return { domain: root, via: 'hierarchy' };
  }
  const bank = node.bankTypeName ? BANK_TYPE_DOMAIN[node.bankTypeName] : null;
  if (bank) return { domain: bank, via: 'bankType' };
  const pathRoot = PATH_ROOT_DOMAIN[trLower(pathRootSourceName)];
  if (pathRoot) return { domain: pathRoot, via: 'path' };
  return { domain: 'unknown', via: 'none' };
}

export const GENDERED_DOMAINS = new Set<AutoMapDomain>([
  'clothing',
  'shoe',
  'accessory',
]);

/** Structural kids signal from provider path / metadata (beats product age). */
export function isStructurallyKids(
  node: SourceNodeInput,
  domain: AutoMapDomain,
): boolean {
  if (domain === 'kids_goods') return true;
  if (trLower(node.gender) === 'child') return true;
  const text = `${trLower(node.hierarchy)} ${trLower(node.sourceName)}`;
  return /bebek|çocuk/.test(text);
}

export function resolveConcept(
  node: SourceNodeInput,
  domain: AutoMapDomain,
): {
  concept: string | null;
  approx: boolean;
  labelDisagreement: boolean;
  via: 'hierarchy' | 'sourceName' | 'group' | 'none';
} {
  const lex = DOMAIN_LEX[domain] || [];
  const segs = hierarchySegments(node.hierarchy);
  const providerLeaf = segs.length ? segs[segs.length - 1] : null;
  const byHierarchy = providerLeaf ? matchLexicon(providerLeaf, lex) : null;
  // Context segments (e.g. "Bebek Giyim", "Fantezi Giyim", "Plaj Giyim").
  const byContext =
    !byHierarchy && segs.length > 1
      ? matchLexicon(segs.slice(1).join(' '), lex)
      : null;
  const byName = matchLexicon(node.sourceName, lex);

  const primary = byHierarchy || byContext;
  if (primary) {
    return {
      concept: primary.concept,
      approx: primary.approx,
      labelDisagreement: !!byName && byName.concept !== primary.concept,
      via: 'hierarchy',
    };
  }
  if (byName) {
    return {
      concept: byName.concept,
      approx: byName.approx,
      labelDisagreement: false,
      via: 'sourceName',
    };
  }
  for (const g of GROUP_LEX) {
    if (g.re.test(trLower(node.sourceName))) {
      return {
        concept: g.concept,
        approx: true,
        labelDisagreement: false,
        via: 'group',
      };
    }
  }
  return {
    concept: null,
    approx: false,
    labelDisagreement: false,
    via: 'none',
  };
}

// ─── Canonical concept index (Persian names) ─────────────────────────────────

export type CanonicalInput = {
  id: number;
  parentId: number | null;
  name: string;
  status: string;
  audience: string | null;
};

/** Persian canonical label (spaces / ZWNJ / standalone «و» removed) → concepts. */
const FA_CONCEPTS: Record<string, string[]> = {
  پیراهن: ['dress', 'shirt'],
  تیشرت: ['tshirt'],
  بلوز: ['blouse'],
  شلوارجین: ['jeans'],
  شلوار: ['pants'],
  ستلباس: ['outfit_set'],
  لباسشنا: ['swimwear'],
  لباسزیر: ['underwear'],
  شلوارک: ['shorts'],
  جوراب: ['socks'],
  سرهمی: ['jumpsuit'],
  کتوشلوار: ['suit'],
  دامن: ['skirt'],
  کتمانتو: ['outerwear'],
  سویشرت: ['sweatshirt'],
  لباسمجلسی: ['evening_dress'],
  لباسراحتی: ['loungewear'],
  پلیورژاکت: ['knitwear'],
  کفشورزشی: ['sneaker'],
  بوتچکمه: ['boots'],
  کفشروزمره: ['casual_shoe'],
  صندلدمپایی: ['sandal_slipper'],
  صندل: ['sandal_slipper'],
  دمپایی: ['sandal_slipper'],
  کفشپاشنهبلند: ['heels'],
  کیف: ['bag'],
  کیفپول: ['wallet'],
  ساعت: ['watch'],
  عینک: ['eyewear'],
  جواهرات: ['jewelry'],
  کلاهشال: ['hat_scarf'],
  لباسنوزاد: ['baby_clothing'],
  ستدوتیکه: ['two_piece_set'],
  زیبایی: ['beauty_root'],
  آرایش: ['makeup'],
  رژلب: ['lip'],
  آرایشچشم: ['eye_makeup'],
  تنماکیاج: ['face_makeup'],
  ناخن: ['nail'],
  مراقبتپوست: ['skincare'],
  مراقبتمو: ['haircare'],
  الکترونیک: ['electronics_root'],
  هدفون: ['headphone'],
  هدفونبلوتوث: ['headphone_bt'],
  تلفن: ['phone'],
  کامپیوترتبلت: ['computer'],
  فناوریپوشیدنی: ['wearable'],
  بازیکنسول: ['gaming'],
  ورزش: ['sport_root'],
  لباسورزشی: ['sportswear'],
  ابزارهایورزشی: ['sport_equipment'],
  لوازمورزشی: ['sport_accessory'],
  تناسباندام: ['fitness'],
  دوچرخه: ['bicycle'],
  فضایباز: ['outdoor'],
  اکسسوری: ['accessory_group'],
  پوشاک: ['clothing_group'],
  کفش: ['shoe_group'],
  خانهزندگی: ['home_root'],
};

/** Root-audience-specific disambiguation of a Persian label. */
const FA_AUDIENCE_OVERRIDE: Partial<
  Record<AutoMapAudience, Record<string, string[]>>
> = {
  men: { پیراهن: ['shirt'] },
};

export function normalizeFaLabel(name: string | null | undefined): string {
  return String(name || '')
    .replace(/[\u200c\u200f\u202a-\u202e]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t !== 'و')
    .join('');
}

export function canonicalAudienceOf(
  raw: string | null | undefined,
): AutoMapAudience {
  const v = trLower(raw);
  if (v === 'female' || v === 'women') return 'women';
  if (v === 'male' || v === 'men') return 'men';
  if (v === 'child' || v === 'kids') return 'kids';
  return 'neutral';
}

export type CanonicalDestination = {
  id: number;
  path: string;
  depth: number;
  ancestorIds: number[];
  /** Other concepts sharing this exact label (ambiguous destination). */
  ambiguousWith: string[];
};

/** audience → concept → candidates (deepest first). */
export type CanonicalConceptIndex = Map<
  AutoMapAudience,
  Map<string, CanonicalDestination[]>
>;

export function lookupDestination(
  index: CanonicalConceptIndex,
  audience: AutoMapAudience,
  concept: string | null,
): CanonicalDestination | null {
  if (!concept) return null;
  return index.get(audience)?.get(concept)?.[0] || null;
}

export function destinationCandidates(
  index: CanonicalConceptIndex,
  audience: AutoMapAudience,
  concept: string | null,
): CanonicalDestination[] {
  if (!concept) return [];
  return index.get(audience)?.get(concept) || [];
}

export function isWithinDestination(
  child: CanonicalDestination,
  parent: CanonicalDestination,
): boolean {
  return child.id === parent.id || child.ancestorIds.includes(parent.id);
}

/** Concepts naming a whole domain / group (their subtree legitimately varies). */
export const GROUP_CONCEPTS = new Set([
  'electronics_root',
  'beauty_root',
  'sport_root',
  'sport_equipment',
  'makeup',
  'accessory_group',
  'clothing_group',
  'shoe_group',
]);

export function buildCanonicalConceptIndex(rows: CanonicalInput[]): {
  index: CanonicalConceptIndex;
  unknownLabels: string[];
} {
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const chain = (id: number): CanonicalInput[] => {
    const out: CanonicalInput[] = [];
    const seen = new Set<number>();
    let cur = byId.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.unshift(cur);
      cur = cur.parentId != null ? byId.get(Number(cur.parentId)) : undefined;
    }
    return out;
  };

  const index: CanonicalConceptIndex = new Map();
  const unknownLabels: string[] = [];
  for (const row of rows) {
    if (row.status !== 'active') continue;
    const path = chain(Number(row.id));
    if (path.some((p) => p.status !== 'active')) continue;
    const audience = canonicalAudienceOf(path[0]?.audience);
    const label = normalizeFaLabel(row.name);
    const concepts =
      FA_AUDIENCE_OVERRIDE[audience]?.[label] || FA_CONCEPTS[label] || null;
    if (!concepts) {
      if (path.length > 1) unknownLabels.push(`${row.id}:${row.name}`);
      continue;
    }
    const map =
      index.get(audience) || new Map<string, CanonicalDestination[]>();
    for (const concept of concepts) {
      const list = map.get(concept) || [];
      list.push({
        id: Number(row.id),
        path: path.map((p) => p.name).join(' / '),
        depth: path.length,
        ancestorIds: path.slice(0, -1).map((p) => Number(p.id)),
        ambiguousWith: concepts.filter((c) => c !== concept),
      });
      // Deepest first (leaf preferred over a group with the same label).
      list.sort((a, b) => b.depth - a.depth || a.id - b.id);
      map.set(concept, list);
    }
    index.set(audience, map);
  }
  return { index, unknownLabels };
}

// ─── Distribution + evidence ─────────────────────────────────────────────────

export type NodeDistribution = {
  total: number;
  female: number;
  male: number;
  unisex: number;
  nullGender: number;
  child: number;
  /** null gender among non-child products. */
  adultNullGender: number;
  titleFemale: number;
  titleFemaleAgree: number;
  titleMale: number;
  titleMaleAgree: number;
};

export function emptyNodeDistribution(): NodeDistribution {
  return {
    total: 0,
    female: 0,
    male: 0,
    unisex: 0,
    nullGender: 0,
    child: 0,
    adultNullGender: 0,
    titleFemale: 0,
    titleFemaleAgree: 0,
    titleMale: 0,
    titleMaleAgree: 0,
  };
}

/** Unicode-aware word boundaries (JS `\b` is ASCII-only; Turkish has ç/ı/ş). */
const TITLE_FEMALE = /(^|[^\p{L}])(kadın|bayan)([^\p{L}]|$)/u;
const TITLE_MALE = /(^|[^\p{L}])erkek([^\p{L}]|$)/u;
const TITLE_CHILD = /(^|[^\p{L}])(çocuk|bebek|kız|unisex çocuk)([^\p{L}]|$)/u;

export function accumulateProduct(
  dist: NodeDistribution,
  product: {
    gender: string | null;
    ageGroup: string | null;
    sourceName: string | null;
  },
): void {
  dist.total += 1;
  const g = product.gender;
  if (g === 'female') dist.female += 1;
  else if (g === 'male') dist.male += 1;
  else if (g === 'unisex') dist.unisex += 1;
  else dist.nullGender += 1;
  const isChild = product.ageGroup === 'child';
  if (isChild) dist.child += 1;
  else if (g == null) dist.adultNullGender += 1;

  const title = trLower(product.sourceName);
  if (TITLE_CHILD.test(title) || /unisex/.test(title)) return;
  const saysFemale = TITLE_FEMALE.test(title);
  const saysMale = TITLE_MALE.test(title);
  if (saysFemale && saysMale) return;
  if (saysFemale) {
    dist.titleFemale += 1;
    if (g === 'female' || g === 'unisex') dist.titleFemaleAgree += 1;
  } else if (saysMale) {
    dist.titleMale += 1;
    if (g === 'male' || g === 'unisex') dist.titleMaleAgree += 1;
  }
}

export function mergeDistributions(
  into: NodeDistribution,
  from: NodeDistribution,
): NodeDistribution {
  for (const key of Object.keys(into) as Array<keyof NodeDistribution>) {
    into[key] += from[key];
  }
  return into;
}

export type AudienceMode =
  | 'women_only'
  | 'men_only'
  | 'mixed'
  | 'unisex_only'
  | 'kids'
  | 'neutral'
  | 'unknown';

export function resolveAudienceMode(input: {
  domain: AutoMapDomain;
  structuralKids: boolean;
  dist: NodeDistribution;
  conceptHasNeutralDestination: boolean;
}): AudienceMode {
  const { dist } = input;
  if (input.structuralKids) return 'kids';
  if (
    !GENDERED_DOMAINS.has(input.domain) ||
    input.conceptHasNeutralDestination
  ) {
    return 'neutral';
  }
  const adult = dist.total - dist.child;
  if (
    dist.total > 0 &&
    dist.child / dist.total >= AUTO_MAP_THRESHOLDS.kidsOwnMin
  ) {
    return 'kids';
  }
  if (adult <= 0) return 'unknown';
  const gendered = dist.female + dist.male + dist.unisex;
  if (gendered === 0) return 'unknown';
  const fS = dist.female / adult;
  const mS = dist.male / adult;
  if (dist.female === 0 && dist.male === 0) return 'unisex_only';
  if (mS <= AUTO_MAP_THRESHOLDS.oppositeNoise) return 'women_only';
  if (fS <= AUTO_MAP_THRESHOLDS.oppositeNoise) return 'men_only';
  return 'mixed';
}

// ─── Proposal ────────────────────────────────────────────────────────────────

export type ProposedRule = {
  genderSlice: 'female' | 'male' | 'any';
  canonicalCategoryId: number;
  canonicalPath: string;
  approx: boolean;
  ambiguousLabel: boolean;
  /** Discoverable products in scope this rule would surface. */
  routedProducts: number;
};

export type DescendantConceptCheck = {
  id: number;
  label: string;
  products: number;
  concept: string | null;
  compatible: boolean;
};

export type AutoMapProposal = {
  engineVersion: string;
  sourceCategoryId: number;
  source: string | null;
  domain: AutoMapDomain;
  domainVia: string;
  concept: string | null;
  conceptVia: string;
  destinationConcept: string | null;
  audienceMode: AudienceMode;
  rules: ProposedRule[];
  tier: AutoMapTier;
  reasonCodes: string[];
  impactProducts: number;
  autoApplyEligible: boolean;
  writableToday: boolean;
  writeBlockers: string[];
  contaminatedDescendantIds: number[];
  unroutable: {
    kidsInAdultScope: number;
    nullGenderAdult: number;
    oppositeNoiseDropped: number;
    sliceWithoutDestination: number;
  };
};

const SENSITIVE_LABEL = /cinsel|dildo|erotik/;

function capTier(current: AutoMapTier, cap: AutoMapTier): AutoMapTier {
  return TIER_ORDER.indexOf(cap) > TIER_ORDER.indexOf(current) ? cap : current;
}

export function proposeForNode(input: {
  node: SourceNodeInput;
  pathRootSourceName: string | null;
  pathLabels: string[];
  /** Distribution over the expanded scope (node + same-source descendants). */
  scopeDist: NodeDistribution;
  descendants: Array<{
    node: SourceNodeInput;
    products: number;
  }>;
  canonicalIndex: CanonicalConceptIndex;
  orphanParent: boolean;
}): AutoMapProposal {
  const { node, scopeDist: dist, canonicalIndex } = input;
  const reasons: string[] = [];
  const { domain, via: domainVia } = resolveDomain(
    node,
    input.pathRootSourceName,
  );
  const conceptRes = resolveConcept(node, domain);
  const concept = conceptRes.concept;
  const destinationConcept = concept
    ? CONCEPT_FALLBACK[concept] || concept
    : null;
  const neutralDest = lookupDestination(
    canonicalIndex,
    'neutral',
    destinationConcept,
  );
  const structuralKids = isStructurallyKids(node, domain);
  const audienceMode = resolveAudienceMode({
    domain,
    structuralKids,
    dist,
    conceptHasNeutralDestination: !!neutralDest,
  });

  const unroutable = {
    kidsInAdultScope: 0,
    nullGenderAdult: 0,
    oppositeNoiseDropped: 0,
    sliceWithoutDestination: 0,
  };
  const rules: ProposedRule[] = [];
  let tier: AutoMapTier = 'AUTO_MAP_HIGH_CONFIDENCE';
  let contaminatedIds: number[] = [];

  function descendantCompatible(
    d: { node: SourceNodeInput; products: number },
    aud: AutoMapAudience,
    dest: CanonicalDestination,
  ): boolean {
    if (d.products <= 0 || !concept) return true;
    const labels = [
      ...hierarchySegments(d.node.hierarchy).slice(-1),
      d.node.sourceName,
    ];
    if (labels.some((l) => labelMatchesConcept(l, concept, domain)))
      return true;
    const dDomain = resolveDomain(d.node, input.pathRootSourceName).domain;
    const dConcept = resolveConcept(d.node, dDomain).concept;
    if (dConcept === concept) return true;
    const dDestConcept = dConcept
      ? CONCEPT_FALLBACK[dConcept] || dConcept
      : null;
    const dDest =
      lookupDestination(canonicalIndex, aud, dDestConcept) ||
      lookupDestination(canonicalIndex, 'neutral', dDestConcept);
    if (dDest) return isWithinDestination(dDest, dest);
    // Domain/group roots legitimately hold same-domain items without a leaf.
    return GROUP_CONCEPTS.has(concept) && dDomain === domain;
  }

  if (domainVia === 'hierarchy') reasons.push('DOMAIN_FROM_PROVIDER_PATH');
  else if (domainVia === 'bankType') reasons.push('DOMAIN_FROM_BANK_TYPE');
  if (input.orphanParent) reasons.push('ORPHAN_PARENT');

  // 1. Local / non-provider nodes.
  if (!node.source) {
    reasons.push('LOCAL_NODE_WITHOUT_PROVIDER');
    return finish('DATA_QUALITY_BLOCKED');
  }
  if (node.status !== 'active') {
    reasons.push('SOURCE_INACTIVE');
    return finish('DATA_QUALITY_BLOCKED');
  }
  // 2. Sensitive content never auto-maps.
  const allLabels = `${trLower(node.hierarchy)} ${input.pathLabels
    .map(trLower)
    .join(' ')}`;
  if (SENSITIVE_LABEL.test(allLabels)) {
    reasons.push('SENSITIVE_CONTENT');
    return finish('HUMAN_REVIEW_REQUIRED');
  }
  // 3. Concept.
  if (!concept) {
    reasons.push('NO_CONCEPT_MATCH');
    return finish('HUMAN_REVIEW_REQUIRED');
  }
  reasons.push(
    conceptRes.via === 'hierarchy'
      ? 'CONCEPT_FROM_PROVIDER_LEAF'
      : conceptRes.via === 'sourceName'
      ? 'CONCEPT_FROM_SOURCE_NAME'
      : 'CONCEPT_FROM_GROUP_NAME',
  );
  if (conceptRes.approx) {
    reasons.push('CONCEPT_APPROXIMATE');
    tier = capTier(tier, 'AUTO_SUGGEST_REVIEW');
  }
  if (conceptRes.labelDisagreement) {
    reasons.push('LABEL_DISAGREEMENT');
    tier = capTier(tier, 'AUTO_SUGGEST_REVIEW');
  }

  // 4. Scope contamination: mapping a node always pulls same-source
  //    descendants. A descendant with products is compatible when its label
  //    names the same concept, or its own destination lies inside ours.
  const destAudiences: AutoMapAudience[] =
    audienceMode === 'kids'
      ? ['kids']
      : audienceMode === 'neutral'
      ? ['neutral']
      : ['women', 'men'];
  const chosen = new Map<AutoMapAudience, CanonicalDestination>();
  for (const aud of destAudiences) {
    const candidates = destinationCandidates(
      canonicalIndex,
      aud,
      destinationConcept,
    );
    if (!candidates.length) continue;
    // Deepest candidate first; widen to a same-label group when descendants
    // land in a sibling leaf (e.g. headphones → group «هدفون»).
    const fits = candidates.find((cand) =>
      input.descendants.every((d) => descendantCompatible(d, aud, cand)),
    );
    if (fits && fits.id !== candidates[0].id) {
      reasons.push('DESTINATION_WIDENED_TO_GROUP');
    }
    chosen.set(aud, fits || candidates[0]);
  }
  const contaminated = input.descendants.filter((d) =>
    [...chosen.entries()].some(
      ([aud, dest]) => !descendantCompatible(d, aud, dest),
    ),
  );
  if (contaminated.length) {
    contaminatedIds = contaminated.map((d) => Number(d.node.id));
    const contaminatedProducts = contaminated.reduce(
      (s, d) => s + d.products,
      0,
    );
    if (
      dist.total > 0 &&
      contaminatedProducts / dist.total <=
        AUTO_MAP_THRESHOLDS.minorContaminationMax
    ) {
      reasons.push('SCOPE_MINOR_CONTAMINATION');
      tier = capTier(tier, 'AUTO_SUGGEST_REVIEW');
    } else {
      reasons.push('SCOPE_CONTAMINATION');
      return finish('DATA_QUALITY_BLOCKED');
    }
  }

  // Group nodes carry no provider path (Trendyol puts it on leaves only):
  // accept the local-path domain when descendants' provider paths agree.
  if (domainVia === 'path') {
    const withProducts = input.descendants.filter((d) => d.products > 0);
    const descTotal = withProducts.reduce((s, d) => s + d.products, 0);
    const agreeing = withProducts
      .filter((d) => {
        const r = resolveDomain(d.node, null);
        return (
          r.via === 'hierarchy' &&
          (r.domain === domain ||
            (domain === 'sport' && r.domain === 'sportswear'))
        );
      })
      .reduce((s, d) => s + d.products, 0);
    const confirmed =
      descTotal > 0 &&
      (GROUP_CONCEPTS.has(concept) ||
        agreeing / descTotal >=
          AUTO_MAP_THRESHOLDS.descendantDomainAgreementMin);
    if (confirmed) {
      reasons.push('DOMAIN_CONFIRMED_BY_DESCENDANTS');
    } else {
      reasons.push('HIERARCHY_MISSING_LOCAL_PATH_ONLY');
      tier = capTier(tier, 'AUTO_SUGGEST_REVIEW');
    }
  }

  // 5. Audience-specific evidence.
  const adult = dist.total - dist.child;
  if (audienceMode === 'kids') {
    if (!structuralKids) reasons.push('KIDS_FROM_PRODUCT_AGE');
    else reasons.push('KIDS_STRUCTURAL_PATH');
    if (structuralKids && dist.total > 0 && dist.child / dist.total < 0.5) {
      reasons.push('PATH_OVERRIDES_PRODUCT_AGE');
    }
    const dest = chosen.get('kids');
    if (!dest) {
      reasons.push('NO_DESTINATION_KIDS');
      return finish('NO_DESTINATION');
    }
    pushRule('any', dest, dist.total);
  } else if (audienceMode === 'neutral') {
    reasons.push('NEUTRAL_DOMAIN');
    const dest = chosen.get('neutral');
    if (!dest) {
      reasons.push('NO_DESTINATION_NEUTRAL');
      return finish('NO_DESTINATION');
    }
    pushRule('any', dest, dist.total);
  } else {
    // Gendered adult domain.
    const kidsShare = dist.total ? dist.child / dist.total : 0;
    if (kidsShare > AUTO_MAP_THRESHOLDS.kidsRemainderMax) {
      reasons.push('MIXED_ADULT_KIDS');
      tier = capTier(tier, 'HUMAN_REVIEW_REQUIRED');
    }
    if (dist.child > 0) {
      reasons.push('KIDS_REMAINDER_UNROUTABLE');
      unroutable.kidsInAdultScope = dist.child;
    }
    if (
      adult > 0 &&
      dist.adultNullGender / adult > AUTO_MAP_THRESHOLDS.adultNullGenderMax
    ) {
      unroutable.nullGenderAdult = dist.adultNullGender;
      if (adult >= AUTO_MAP_THRESHOLDS.titleMinSample) {
        reasons.push('NULL_GENDER_DOMINANT');
        return finish('DATA_QUALITY_BLOCKED');
      }
      reasons.push('NULL_GENDER_SMALL_SAMPLE');
      tier = capTier(tier, 'AUTO_SUGGEST_REVIEW');
    }
    if (dist.adultNullGender > 0) {
      reasons.push('NULL_GENDER_UNROUTABLE');
      unroutable.nullGenderAdult = dist.adultNullGender;
    }
    if (audienceMode === 'unknown') {
      reasons.push('AUDIENCE_UNKNOWN');
      return finish('HUMAN_REVIEW_REQUIRED');
    }

    const women = chosen.get('women') || null;
    const men = chosen.get('men') || null;
    const wantFemale = audienceMode !== 'men_only';
    const wantMale = audienceMode !== 'women_only';
    reasons.push(
      audienceMode === 'women_only'
        ? 'AUDIENCE_SINGLE_FEMALE'
        : audienceMode === 'men_only'
        ? 'AUDIENCE_SINGLE_MALE'
        : audienceMode === 'unisex_only'
        ? 'AUDIENCE_UNISEX_ONLY'
        : 'AUDIENCE_MIXED_SPLIT',
    );
    if (audienceMode === 'women_only' && dist.male > 0) {
      reasons.push('OPPOSITE_NOISE_DROPPED');
      unroutable.oppositeNoiseDropped = dist.male;
    }
    if (audienceMode === 'men_only' && dist.female > 0) {
      reasons.push('OPPOSITE_NOISE_DROPPED');
      unroutable.oppositeNoiseDropped = dist.female;
    }

    if (
      FEMALE_ONLY_CONCEPTS.has(concept) &&
      dist.male / Math.max(adult, 1) > AUTO_MAP_THRESHOLDS.oppositeNoise
    ) {
      reasons.push('GENDER_CONCEPT_CONFLICT');
      tier = capTier(tier, 'HUMAN_REVIEW_REQUIRED');
    }
    if (
      MALE_ONLY_CONCEPTS.has(concept) &&
      dist.female / Math.max(adult, 1) > AUTO_MAP_THRESHOLDS.oppositeNoise
    ) {
      reasons.push('GENDER_CONCEPT_CONFLICT');
      tier = capTier(tier, 'HUMAN_REVIEW_REQUIRED');
    }

    const titled = dist.titleFemale + dist.titleMale;
    if (titled >= AUTO_MAP_THRESHOLDS.titleMinSample) {
      const agree = (dist.titleFemaleAgree + dist.titleMaleAgree) / titled;
      if (agree < AUTO_MAP_THRESHOLDS.titleAgreementMin) {
        reasons.push('TITLE_GENDER_CONFLICT');
        tier = capTier(tier, 'HUMAN_REVIEW_REQUIRED');
      } else {
        reasons.push('TITLE_GENDER_AGREES');
      }
    }

    if (wantFemale) {
      if (women) pushRule('female', women, dist.female + dist.unisex);
      else if (dist.female > 0) {
        reasons.push('NO_DESTINATION_WOMEN');
        unroutable.sliceWithoutDestination += dist.female;
      }
    }
    if (wantMale) {
      if (men) pushRule('male', men, dist.male + dist.unisex);
      else if (dist.male > 0) {
        reasons.push('NO_DESTINATION_MEN');
        unroutable.sliceWithoutDestination += dist.male;
      }
    }
    if (!rules.length) return finish('NO_DESTINATION');
    if (unroutable.sliceWithoutDestination > 0) {
      reasons.push('PARTIAL_SLICE_DESTINATION');
      tier = capTier(tier, 'AUTO_SUGGEST_REVIEW');
    }
  }

  if (rules.some((r) => r.ambiguousLabel)) {
    reasons.push('CANONICAL_LABEL_AMBIGUOUS');
    tier = capTier(tier, 'AUTO_SUGGEST_REVIEW');
  }
  if (rules.some((r) => r.approx)) tier = capTier(tier, 'AUTO_SUGGEST_REVIEW');

  return finish(tier);

  function pushRule(
    slice: 'female' | 'male' | 'any',
    dest: CanonicalDestination,
    routed: number,
  ) {
    rules.push({
      genderSlice: slice,
      canonicalCategoryId: dest.id,
      canonicalPath: dest.path,
      approx: destinationConcept !== concept,
      ambiguousLabel: dest.ambiguousWith.length > 0,
      routedProducts: routed,
    });
  }

  function finish(finalTier: AutoMapTier): AutoMapProposal {
    const writeBlockers: string[] = [];
    if (rules.some((r) => r.genderSlice === 'any')) {
      writeBlockers.push(
        audienceMode === 'kids'
          ? 'WRITE_BLOCKED_KIDS_ROOT'
          : 'WRITE_BLOCKED_NEUTRAL_ANY_DISABLED',
      );
    }
    const impact = dist.total;
    const highImpact = impact >= AUTO_MAP_THRESHOLDS.highImpact;
    if (highImpact) reasons.push('HIGH_IMPACT_CONFIRM_REQUIRED');
    return {
      engineVersion: AUTO_MAP_ENGINE_VERSION,
      sourceCategoryId: Number(node.id),
      source: node.source,
      domain,
      domainVia,
      concept,
      conceptVia: conceptRes.via,
      destinationConcept,
      audienceMode,
      rules:
        finalTier === 'NO_DESTINATION' || finalTier === 'DATA_QUALITY_BLOCKED'
          ? []
          : rules,
      tier: finalTier,
      reasonCodes: [...new Set(reasons)],
      impactProducts: impact,
      autoApplyEligible:
        finalTier === 'AUTO_MAP_HIGH_CONFIDENCE' && !highImpact,
      writableToday: writeBlockers.length === 0,
      writeBlockers,
      contaminatedDescendantIds: contaminatedIds,
      unroutable,
    };
  }
}

// ─── Persian review reasons (human queue) ────────────────────────────────────

export const REASON_FA: Record<string, string> = {
  DOMAIN_FROM_PROVIDER_PATH:
    'حوزه از مسیر دسته‌بندی تأمین‌کننده تشخیص داده شد.',
  DOMAIN_FROM_BANK_TYPE: 'حوزه از نوع کالای تأمین‌کننده تشخیص داده شد.',
  HIERARCHY_MISSING_LOCAL_PATH_ONLY:
    'مسیر تأمین‌کننده موجود نیست؛ فقط از درخت محلی استفاده شد.',
  ORPHAN_PARENT: 'والد این دسته در جدول دسته‌ها وجود ندارد.',
  LOCAL_NODE_WITHOUT_PROVIDER: 'گره محلی بدون منبع تأمین‌کننده است.',
  SOURCE_INACTIVE: 'دسته منبع غیرفعال است.',
  SENSITIVE_CONTENT: 'محتوای حساس؛ نگاشت خودکار مجاز نیست.',
  NO_CONCEPT_MATCH: 'نوع کالا از روی نام دسته قابل تشخیص نبود.',
  CONCEPT_FROM_PROVIDER_LEAF: 'نوع کالا از نام دسته تأمین‌کننده تشخیص داده شد.',
  CONCEPT_FROM_SOURCE_NAME: 'نوع کالا از نام محلی دسته تشخیص داده شد.',
  CONCEPT_FROM_GROUP_NAME: 'فقط سطح گروه قابل تشخیص بود.',
  CONCEPT_APPROXIMATE: 'مقصد دقیق وجود ندارد؛ نزدیک‌ترین دسته پیشنهاد شد.',
  LABEL_DISAGREEMENT: 'نام تأمین‌کننده و نام محلی دسته با هم هم‌خوان نیستند.',
  SCOPE_MINOR_CONTAMINATION:
    'تعداد کمی محصول از نوع دیگر زیر این دسته است؛ بازبینی سریع لازم است.',
  DOMAIN_CONFIRMED_BY_DESCENDANTS:
    'حوزه این گروه با مسیر تأمین‌کننده زیردسته‌ها تأیید شد.',
  NULL_GENDER_SMALL_SAMPLE: 'جنسیت چند محصول نامشخص است و نمونه کوچک است.',
  SCOPE_CONTAMINATION:
    'زیردسته‌هایی با نوع کالای دیگر زیر این دسته قرار گرفته‌اند؛ نگاشت آن‌ها را هم جابه‌جا می‌کند.',
  KIDS_FROM_PRODUCT_AGE: 'بیشتر محصولات بچگانه هستند.',
  KIDS_STRUCTURAL_PATH: 'مسیر تأمین‌کننده بچگانه/نوزاد است.',
  PATH_OVERRIDES_PRODUCT_AGE:
    'برچسب سنی محصولات با مسیر بچگانه هم‌خوان نیست؛ مسیر ملاک قرار گرفت.',
  NO_DESTINATION_KIDS: 'دسته مقصد بچگانه برای این نوع کالا وجود ندارد.',
  NEUTRAL_DOMAIN: 'حوزه خنثی (بدون جنسیت) است.',
  NO_DESTINATION_NEUTRAL: 'دسته مقصد خنثی برای این نوع کالا وجود ندارد.',
  MIXED_ADULT_KIDS: 'ترکیب قابل‌توجهی از محصولات بزرگسال و بچگانه دارد.',
  KIDS_REMAINDER_UNROUTABLE:
    'محصولات بچگانه داخل این دسته بزرگسال با قوانین فعلی قابل مسیریابی نیستند.',
  NULL_GENDER_DOMINANT: 'جنسیت بخش زیادی از محصولات بزرگسال نامشخص است.',
  NULL_GENDER_UNROUTABLE:
    'محصولات بزرگسال بدون جنسیت در صفحات زنانه/مردانه نمایش داده نمی‌شوند.',
  AUDIENCE_UNKNOWN: 'مخاطب (زنانه/مردانه) قابل تشخیص نیست.',
  AUDIENCE_SINGLE_FEMALE: 'محصولات تقریباً فقط زنانه‌اند.',
  AUDIENCE_SINGLE_MALE: 'محصولات تقریباً فقط مردانه‌اند.',
  AUDIENCE_UNISEX_ONLY: 'محصولات یونیسکس هستند.',
  AUDIENCE_MIXED_SPLIT:
    'محصولات زنانه و مردانه دارد؛ به دو قانون جدا تقسیم شد.',
  OPPOSITE_NOISE_DROPPED:
    'تعداد بسیار کمی محصول با جنسیت مخالف کنار گذاشته شد.',
  GENDER_CONCEPT_CONFLICT: 'جنسیت محصولات با نوع کالا تناقض دارد.',
  TITLE_GENDER_CONFLICT: 'عنوان محصولات با جنسیت ثبت‌شده هم‌خوان نیست.',
  TITLE_GENDER_AGREES: 'عنوان محصولات جنسیت ثبت‌شده را تأیید می‌کند.',
  NO_DESTINATION_WOMEN: 'دسته مقصد زنانه برای این نوع کالا وجود ندارد.',
  NO_DESTINATION_MEN: 'دسته مقصد مردانه برای این نوع کالا وجود ندارد.',
  PARTIAL_SLICE_DESTINATION: 'فقط برای یکی از جنسیت‌ها مقصد وجود دارد.',
  CANONICAL_LABEL_AMBIGUOUS:
    'نام دسته مقصد مبهم است (مثلاً «پیراهن» زنانه: پیراهن مجلسی یا پیراهن مردانه‌وار).',
  HIGH_IMPACT_CONFIRM_REQUIRED: 'نگاشت پرتأثیر است و تأیید صریح لازم دارد.',
  DESTINATION_WIDENED_TO_GROUP:
    'زیردسته‌ها در چند برگ مقصد قرار می‌گیرند؛ گروه مقصد پیشنهاد شد.',
  WRITE_BLOCKED_NEUTRAL_ANY_DISABLED:
    'ذخیره نگاشت any برای مقصد خنثی در API نسخه ۲ هنوز فعال نیست.',
  WRITE_BLOCKED_KIDS_ROOT:
    'مسیر ذخیره نسخه ۲ برای دسته‌های بچگانه اسلایس مجازی ندارد.',
};
