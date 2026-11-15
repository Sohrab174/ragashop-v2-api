-- LOCAL / Production preflight SQL — storefront PLP reachability gaps.
-- Idempotent. Does not change taxonomy trees or product.categoryId.
-- Uses explicit sourceCategoryId → canonicalCategoryId (+ optional genderSlice).
--
-- Prior launch gaps (kept):
--   81 sneakers, 217 classic heels, 346 polo
-- Release gaps (this pass):
--   underwear leaves (Külot / sports bra / İçlik)
--   Jean gender split (women 21 / men 41)
--   Sneaker gender split (women 28 / men 45)
--   Pantolon / Kazak gender splits for empty fashion canons

-- ---------- sneakers / heels / polo (existing) ----------
INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 81, 28, 'any', 'active', 'reviewed_ok',
  'launch-nav-gap: sneakers leaf → کفش ورزشی', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=81 AND genderSlice='any'
)
AND NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=81 AND genderSlice='female'
);

INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 217, 32, 'any', 'active', 'reviewed_ok',
  'launch-nav-gap: classic heels leaf → کفش پاشنه بلند (parent 703 source-null blocked expansion from 215)', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=217 AND genderSlice='any'
);

INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 346, 19, 'any', 'active', 'reviewed_ok',
  'launch-nav-gap: polo tee leaf → تیشرت', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=346 AND genderSlice='any'
);

-- ---------- underwear release gaps ----------
INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 11, 87, 'female', 'active', 'reviewed_ok',
  'release-nav-gap: Külot → لباس زیر زنانه', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=11 AND genderSlice='female'
);

INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 11, 94, 'male', 'active', 'reviewed_ok',
  'release-nav-gap: Külot male → لباس زیر مردانه', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=11 AND genderSlice='male'
);

INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 185, 87, 'any', 'active', 'reviewed_ok',
  'release-nav-gap: Sporcu Sütyeni → لباس زیر زنانه', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=185 AND genderSlice='any'
);

INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 103, 87, 'female', 'active', 'reviewed_ok',
  'release-nav-gap: İçlik female → لباس زیر زنانه', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=103 AND genderSlice='female'
);

INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 103, 94, 'male', 'active', 'reviewed_ok',
  'release-nav-gap: İçlik male → لباس زیر مردانه', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=103 AND genderSlice='male'
);

-- ---------- Jean: split any→male/female ----------
UPDATE source_category_mapping
SET genderSlice = 'male',
    note = 'release-nav-gap: Jean male → شلوار جین مردانه',
    reviewStatus = 'reviewed_ok',
    updatedAt = NOW()
WHERE sourceCategoryId = 19
  AND genderSlice = 'any'
  AND canonicalCategoryId = 41
  AND status = 'active';

INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 19, 21, 'female', 'active', 'reviewed_ok',
  'release-nav-gap: Jean female → شلوار جین زنانه', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=19 AND genderSlice='female'
);

-- ---------- Sneaker: split any→female/male ----------
UPDATE source_category_mapping
SET genderSlice = 'female',
    note = 'release-nav-gap: Sneaker female → کفش ورزشی زنانه',
    reviewStatus = 'reviewed_ok',
    updatedAt = NOW()
WHERE sourceCategoryId = 81
  AND genderSlice = 'any'
  AND canonicalCategoryId = 28
  AND status = 'active';

INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 81, 45, 'male', 'active', 'reviewed_ok',
  'release-nav-gap: Sneaker male → کفش ورزشی مردانه', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=81 AND genderSlice='male'
);

-- ---------- Pantolon / Kazak empty fashion canons ----------
INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 14, 84, 'female', 'active', 'reviewed_ok',
  'release-nav-gap: Pantolon female → شلوار زنانه', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=14 AND genderSlice='female'
);

INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 14, 91, 'male', 'active', 'reviewed_ok',
  'release-nav-gap: Pantolon male → شلوار مردانه', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=14 AND genderSlice='male'
);

INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 27, 27, 'female', 'active', 'reviewed_ok',
  'release-nav-gap: Kazak female → پلیور و ژاکت زنانه', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=27 AND genderSlice='female'
);

INSERT INTO source_category_mapping
  (source, sourceCategoryId, canonicalCategoryId, genderSlice, status, reviewStatus, note, createdAt, updatedAt)
SELECT 'trendyol', 27, 44, 'male', 'active', 'reviewed_ok',
  'release-nav-gap: Kazak male → پلیور و ژاکت مردانه', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM source_category_mapping WHERE sourceCategoryId=27 AND genderSlice='male'
);
