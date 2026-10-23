/**
 * Catalog search candidate WHERE clauses.
 * Keep matching strict enough that unmatched queries return zero rows
 * without falling back to a full catalog scan via fuzzy OR prefixes.
 */

import { escapeLikePattern } from './search-normalize';
import { persianNormalizeSql } from './search-ranking';

export type SearchCandidateFilterInput = {
  tokens: string[];
  normalizedQuery: string;
  exactBrandIds: number[];
  typoBrandIds: number[];
  categorySourceIds: number[];
};

export type SearchCandidateFilterSql = {
  sql: string;
  params: Record<string, unknown>;
};

function uniqueNums(values: number[]): number[] {
  return [...new Set(values.filter((n) => Number.isFinite(n) && n > 0))];
}

/**
 * Build the candidate OR group for catalog search.
 *
 * A product matches when any of these hold:
 * - brand id is an exact/typo brand hit for the query
 * - category source id is a strong category name hit
 * - the full normalized phrase appears in the product name
 * - every token appears in name / brand / category (AND across tokens)
 *
 * Fuzzy “drop last character” prefixes are intentionally excluded here.
 * Ranking may still boost near-misses among rows that already matched.
 */
export function buildSearchCandidateFilterSql(
  input: SearchCandidateFilterInput,
): SearchCandidateFilterSql | null {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  const nameNorm = persianNormalizeSql('product.name');
  const brandNameNorm = persianNormalizeSql('brand.name');
  const brandSourceNorm = persianNormalizeSql('brand.sourceName');
  const categoryNameNorm = persianNormalizeSql('category.name');

  const brandIds = uniqueNums([
    ...input.exactBrandIds,
    ...input.typoBrandIds,
  ]);
  if (brandIds.length) {
    clauses.push('product.brandId IN (:...searchBrandIds)');
    params.searchBrandIds = brandIds;
  }
  if (input.categorySourceIds.length) {
    clauses.push('product.categoryId IN (:...searchCatSourceIds)');
    params.searchCatSourceIds = input.categorySourceIds;
  }

  const phrase = (input.normalizedQuery || '').trim();
  if (phrase) {
    clauses.push(`${nameNorm} LIKE :searchPhrase ESCAPE '\\\\'`);
    params.searchPhrase = `%${escapeLikePattern(phrase)}%`;
  }

  const tokens = input.tokens.filter((t) => t.length > 0);
  if (tokens.length === 1) {
    const escaped = escapeLikePattern(tokens[0]);
    clauses.push(
      `(${nameNorm} LIKE :searchTok0 ESCAPE '\\\\' OR ${brandNameNorm} LIKE :searchTok0 ESCAPE '\\\\' OR ${brandSourceNorm} LIKE :searchTok0 ESCAPE '\\\\' OR ${categoryNameNorm} LIKE :searchTok0 ESCAPE '\\\\')`,
    );
    params.searchTok0 = `%${escaped}%`;
  } else if (tokens.length > 1) {
    // Require every token so multi-word nonsense (e.g. zzzz-no-such-item)
    // cannot match via a single common English fragment like "item".
    const tokenAnd = tokens.map((token, index) => {
      const likeKey = `searchTok${index}`;
      params[likeKey] = `%${escapeLikePattern(token)}%`;
      return `(${nameNorm} LIKE :${likeKey} ESCAPE '\\\\' OR ${brandNameNorm} LIKE :${likeKey} ESCAPE '\\\\' OR ${brandSourceNorm} LIKE :${likeKey} ESCAPE '\\\\' OR ${categoryNameNorm} LIKE :${likeKey} ESCAPE '\\\\')`;
    });
    clauses.push(`(${tokenAnd.join(' AND ')})`);
  }

  if (!clauses.length) return null;
  return {
    sql: `(${clauses.join(' OR ')})`,
    params,
  };
}
