/**
 * Search V1 ranking weights — centralized, deterministic, tunable.
 * Future signals (popularity, margin, …) can add keys without scattering magic.
 */

export const SEARCH_RANKING_WEIGHTS = {
  exactNormalizedName: 1000,
  namePrefix: 850,
  namePhraseContains: 720,
  exactBrandAlias: 680,
  brandNameToken: 520,
  titleAllTokens: 480,
  titleToken: 360,
  canonicalCategory: 340,
  sourceCategoryName: 280,
  partialName: 180,
  typoBrandAlias: 140,
  typoNamePrefix: 90,
} as const;

export type SearchRankingWeightKey = keyof typeof SEARCH_RANKING_WEIGHTS;

export type SearchMatchHints = {
  exactBrandIds: number[];
  typoBrandIds: number[];
  categorySourceIds: number[];
  tokens: string[];
  normalizedQuery: string;
};

/**
 * Build a parameterized SQL expression for relevance scoring.
 * Callers must bind the returned params onto the query builder.
 */
export function buildSearchRelevanceSql(
  hints: SearchMatchHints,
  productAlias = 'product',
  brandAlias = 'brand',
  categoryAlias = 'category',
): { sql: string; params: Record<string, unknown> } {
  const w = SEARCH_RANKING_WEIGHTS;
  const params: Record<string, unknown> = {
    rankExactName: hints.normalizedQuery,
    rankPrefix: `${escapeForLike(hints.normalizedQuery)}%`,
    rankPhrase: `%${escapeForLike(hints.normalizedQuery)}%`,
  };

  const parts: string[] = ['0'];

  // Name exact / prefix / phrase (MySQL LOWER + REPLACE for ی/ک)
  const nameNorm = persianNormalizeSql(`${productAlias}.name`);
  parts.push(
    `CASE WHEN ${nameNorm} = :rankExactName THEN ${w.exactNormalizedName} ELSE 0 END`,
  );
  parts.push(
    `CASE WHEN ${nameNorm} LIKE :rankPrefix ESCAPE '\\\\' THEN ${w.namePrefix} ELSE 0 END`,
  );
  parts.push(
    `CASE WHEN ${nameNorm} LIKE :rankPhrase ESCAPE '\\\\' THEN ${w.namePhraseContains} ELSE 0 END`,
  );

  if (hints.exactBrandIds.length) {
    params.rankExactBrandIds = hints.exactBrandIds;
    parts.push(
      `CASE WHEN ${productAlias}.brandId IN (:...rankExactBrandIds) THEN ${w.exactBrandAlias} ELSE 0 END`,
    );
  }
  if (hints.typoBrandIds.length) {
    params.rankTypoBrandIds = hints.typoBrandIds;
    parts.push(
      `CASE WHEN ${productAlias}.brandId IN (:...rankTypoBrandIds) THEN ${w.typoBrandAlias} ELSE 0 END`,
    );
  }
  if (hints.categorySourceIds.length) {
    params.rankCategorySourceIds = hints.categorySourceIds;
    parts.push(
      `CASE WHEN ${productAlias}.categoryId IN (:...rankCategorySourceIds) THEN ${w.canonicalCategory} ELSE 0 END`,
    );
  }

  hints.tokens.forEach((token, index) => {
    const key = `rankTok${index}`;
    const prefixKey = `rankTokPrefix${index}`;
    params[key] = `%${escapeForLike(token)}%`;
    params[prefixKey] = `${escapeForLike(token)}%`;
    parts.push(
      `CASE WHEN ${nameNorm} LIKE :${key} ESCAPE '\\\\' THEN ${w.titleToken} ELSE 0 END`,
    );
    parts.push(
      `CASE WHEN ${persianNormalizeSql(
        `${brandAlias}.name`,
      )} LIKE :${key} ESCAPE '\\\\' OR ${persianNormalizeSql(
        `${brandAlias}.sourceName`,
      )} LIKE :${key} ESCAPE '\\\\' THEN ${w.brandNameToken} ELSE 0 END`,
    );
    parts.push(
      `CASE WHEN ${persianNormalizeSql(
        `${categoryAlias}.name`,
      )} LIKE :${key} ESCAPE '\\\\' THEN ${w.sourceCategoryName} ELSE 0 END`,
    );
    // Light title typo: prefix of token (drop last char) when token is long enough
    if (token.length >= 4) {
      const typoKey = `rankTokTypo${index}`;
      params[typoKey] = `${escapeForLike(token.slice(0, -1))}%`;
      parts.push(
        `CASE WHEN ${nameNorm} LIKE :${typoKey} ESCAPE '\\\\' THEN ${w.typoNamePrefix} ELSE 0 END`,
      );
    }
  });

  if (hints.tokens.length > 1) {
    const allTokenClauses = hints.tokens.map((_, index) => {
      return `${nameNorm} LIKE :rankTok${index} ESCAPE '\\\\'`;
    });
    parts.push(
      `CASE WHEN (${allTokenClauses.join(' AND ')}) THEN ${
        w.titleAllTokens
      } ELSE 0 END`,
    );
  }

  return {
    sql: `(${parts.join(' + ')})`,
    params,
  };
}

function escapeForLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** SQL expression normalizing Persian/Arabic letter variants on a column. */
export function persianNormalizeSql(columnExpr: string): string {
  return `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(${columnExpr}, 'ي', 'ی'), 'ك', 'ک'), 'ة', 'ه'), 'ـ', ''))`;
}
