/**
 * CAT-MAP-V2-C — atomic V2 mapping save validation (pure rules).
 *
 * Launch writes: female, male.
 * Rejects: unknown, casual gendered-root `any`, inactive destinations,
 * destination audience mismatches, duplicate slices, high-impact without confirm.
 */

import { AudienceContext } from './canonical-presentation-image';
import {
  SourceCategoryMappingGenderSlice,
  SourceCategoryMappingReviewStatus,
  SourceCategoryMappingStatus,
} from './entities/source-category-mapping.entity';

export class SourceCategoryMappingV2ValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_source'
      | 'inactive_source'
      | 'invalid_canonical'
      | 'inactive_canonical'
      | 'invalid_slice'
      | 'duplicate_slice'
      | 'audience_mismatch'
      | 'confirm_required'
      | 'empty_rules'
      | 'invalid_status' = 'invalid_slice',
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SourceCategoryMappingV2ValidationError';
  }
}

/** Default high-impact threshold (affected discoverable products in source scope). */
export const MAPPING_HIGH_IMPACT_DEFAULT = 500;

export function resolveHighImpactThreshold(): number {
  const raw = process.env.MAPPING_HIGH_IMPACT_THRESHOLD;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : MAPPING_HIGH_IMPACT_DEFAULT;
}

export type V2SaveRuleInput = {
  genderSlice: string;
  canonicalCategoryId: number;
  status?: string;
};

export type ValidatedV2SaveRule = {
  genderSlice: SourceCategoryMappingGenderSlice;
  canonicalCategoryId: number;
  status: SourceCategoryMappingStatus;
  canonicalAudience: AudienceContext;
};

const LAUNCH_WRITABLE_SLICES = new Set<string>([
  SourceCategoryMappingGenderSlice.female,
  SourceCategoryMappingGenderSlice.male,
]);

export function expectedAudienceForSlice(
  slice: SourceCategoryMappingGenderSlice,
): AudienceContext | 'neutral-any' {
  if (slice === SourceCategoryMappingGenderSlice.female) return 'women';
  if (slice === SourceCategoryMappingGenderSlice.male) return 'men';
  if (slice === SourceCategoryMappingGenderSlice.any) return 'neutral-any';
  return 'neutral';
}

export function assertSliceDestinationCompatible(
  slice: SourceCategoryMappingGenderSlice,
  destinationRootAudience: AudienceContext,
): void {
  if (slice === SourceCategoryMappingGenderSlice.female) {
    if (destinationRootAudience !== 'women') {
      throw new SourceCategoryMappingV2ValidationError(
        'نگاشت زنانه فقط به دسته‌بندی‌های ریشه زنانه مجاز است.',
        'audience_mismatch',
        { slice, destinationRootAudience },
      );
    }
    return;
  }
  if (slice === SourceCategoryMappingGenderSlice.male) {
    if (destinationRootAudience !== 'men') {
      throw new SourceCategoryMappingV2ValidationError(
        'نگاشت مردانه فقط به دسته‌بندی‌های ریشه مردانه مجاز است.',
        'audience_mismatch',
        { slice, destinationRootAudience },
      );
    }
    return;
  }
  if (slice === SourceCategoryMappingGenderSlice.any) {
    if (destinationRootAudience !== 'neutral') {
      throw new SourceCategoryMappingV2ValidationError(
        'نگاشت any فقط برای دسته‌بندی‌های خنثی مجاز است.',
        'audience_mismatch',
        { slice, destinationRootAudience },
      );
    }
  }
}

/**
 * Validate the requested V2 rule set (pure; no I/O).
 * Caller supplies resolved destination root audiences + impact count.
 */
export function validateV2MappingSaveRequest(input: {
  rules: V2SaveRuleInput[];
  confirmImpact?: boolean;
  /** Discoverable products in the source scope (impact UI). */
  impactProductCount: number;
  resolveDestination: (canonicalCategoryId: number) => {
    exists: boolean;
    active: boolean;
    rootAudience: AudienceContext;
  } | null;
  /** When true, allow reviewed `any` → neutral destinations. Default false for launch. */
  allowNeutralAny?: boolean;
}): ValidatedV2SaveRule[] {
  if (!input.rules?.length) {
    throw new SourceCategoryMappingV2ValidationError(
      'حداقل یک قانون نگاشت لازم است.',
      'empty_rules',
    );
  }

  const seen = new Set<string>();
  const validated: ValidatedV2SaveRule[] = [];

  for (const rule of input.rules) {
    const slice = String(rule.genderSlice || '').trim();
    if (slice === 'unknown' || slice === '') {
      throw new SourceCategoryMappingV2ValidationError(
        'اسلایس unknown مجاز نیست.',
        'invalid_slice',
      );
    }
    if (slice === SourceCategoryMappingGenderSlice.unisex) {
      throw new SourceCategoryMappingV2ValidationError(
        'اسلایس unisex در مسیر پیش‌فرض V2 لازم نیست؛ محصولات یونیسکس با مسیرهای زنانه/مردانه نمایش داده می‌شوند.',
        'invalid_slice',
      );
    }
    if (slice === SourceCategoryMappingGenderSlice.any) {
      if (!input.allowNeutralAny) {
        throw new SourceCategoryMappingV2ValidationError(
          'ایجاد نگاشت any از API نسخه ۲ مجاز نیست؛ برای مسیرهای جنسیتی از female/male استفاده کنید.',
          'invalid_slice',
        );
      }
    } else if (!LAUNCH_WRITABLE_SLICES.has(slice)) {
      throw new SourceCategoryMappingV2ValidationError(
        `اسلایس نامعتبر: ${slice}`,
        'invalid_slice',
      );
    }

    if (seen.has(slice)) {
      throw new SourceCategoryMappingV2ValidationError(
        `اسلایس تکراری در درخواست: ${slice}`,
        'duplicate_slice',
      );
    }
    seen.add(slice);

    const canonicalCategoryId = Number(rule.canonicalCategoryId);
    if (!Number.isInteger(canonicalCategoryId) || canonicalCategoryId <= 0) {
      throw new SourceCategoryMappingV2ValidationError(
        'دسته‌بندی فروشگاه نامعتبر است.',
        'invalid_canonical',
      );
    }

    const dest = input.resolveDestination(canonicalCategoryId);
    if (!dest || !dest.exists) {
      throw new SourceCategoryMappingV2ValidationError(
        'دسته‌بندی فروشگاه یافت نشد.',
        'invalid_canonical',
        { canonicalCategoryId },
      );
    }
    if (!dest.active) {
      throw new SourceCategoryMappingV2ValidationError(
        'دسته‌بندی فروشگاه غیرفعال است.',
        'inactive_canonical',
        { canonicalCategoryId },
      );
    }

    const genderSlice = slice as SourceCategoryMappingGenderSlice;
    assertSliceDestinationCompatible(genderSlice, dest.rootAudience);

    const statusRaw = rule.status ?? SourceCategoryMappingStatus.active;
    if (
      !Object.values(SourceCategoryMappingStatus).includes(
        statusRaw as SourceCategoryMappingStatus,
      )
    ) {
      throw new SourceCategoryMappingV2ValidationError(
        'وضعیت نگاشت نامعتبر است.',
        'invalid_status',
      );
    }

    validated.push({
      genderSlice,
      canonicalCategoryId,
      status: statusRaw as SourceCategoryMappingStatus,
      canonicalAudience: dest.rootAudience,
    });
  }

  const threshold = resolveHighImpactThreshold();
  if (input.impactProductCount >= threshold && input.confirmImpact !== true) {
    throw new SourceCategoryMappingV2ValidationError(
      'این نگاشت پرتأثیر است؛ تأیید صریح لازم است.',
      'confirm_required',
      {
        impactProductCount: input.impactProductCount,
        threshold,
        confirmImpactRequired: true,
      },
    );
  }

  return validated;
}

/**
 * Review status after a successful employee V2 save.
 * - Had active legacy any → migrated
 * - Otherwise → reviewed_ok
 */
export function resolveV2SaveReviewStatus(input: {
  hadActiveLegacyAny: boolean;
}): SourceCategoryMappingReviewStatus {
  return input.hadActiveLegacyAny
    ? SourceCategoryMappingReviewStatus.migrated
    : SourceCategoryMappingReviewStatus.reviewed_ok;
}
