/**
 * SCOPE-2 assortment policy — framework-free surface for later crawler reuse.
 *
 * Choice: keep the pure evaluator inside the API catalog module (not a new
 * monorepo package yet) to avoid packaging complexity. The evaluate/normalize/
 * validate modules have zero Nest/TypeORM imports and can be extracted to
 * packages/assortment-policy later without copying business logic.
 */
export {
  evaluateAssortmentPolicy,
  summarizeAssortmentDecisions,
} from './assortment-policy.evaluate';
export {
  normalizePathPrefix,
  normalizePathSegments,
  isSegmentPrefix,
  buildPathSelectorKey,
  buildCategorySelectorKey,
} from './assortment-path.normalize';
export {
  validateAssortmentRuleDraft,
  findDuplicateActiveSelectors,
  AssortmentPolicyRuleValidationError,
} from './assortment-policy.validate';
export * from './assortment-policy.types';
export {
  SCOPE2_INITIAL_PATH_RULE_DRAFTS,
  ASSORTMENT_POLICY_SYSTEM_ACTOR,
} from './assortment-policy.seed-data';
export {
  planAssortmentRecompute,
  activeRuleFingerprint,
  diffResolutions,
} from './assortment-policy.recompute-plan';
export {
  resolveAssortmentGate,
  isMappingEligibleStatus,
  buildAssortmentAwareCoverage,
  classifyLegacyMappingsByAssortment,
} from './assortment-auto-map.gate';
export {
  assortmentStatusLabelFa,
  assortmentReasonLabelFa,
  assortmentViaLabelFa,
} from './assortment-policy.labels';
export {
  evaluateAssortmentCommerceGate,
  filterInScopeSourceCategoryIds,
  assortmentInScopeDiscoverySql,
  applyAssortmentDiscoveryFilter,
  resolveCrawlerAssortmentGate,
  isAssortmentDiscoveryEnforcementEnabled,
  isAssortmentCommerceEnforcementEnabled,
  isAssortmentCrawlerEnforcementEnabled,
  ASSORTMENT_OUT_CUSTOMER_MESSAGE,
  ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
} from './assortment-enforcement';
