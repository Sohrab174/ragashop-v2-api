import { HttpException } from '@nestjs/common';
import { MarketplaceImportFailureClassification } from './marketplace-import-job.types';
import {
  MarketplaceImportQueueFullError,
  MarketplaceImportQueueTimeoutError,
} from './marketplace-import-concurrency';
import { MarketplaceRedirectError } from './marketplace-redirect.resolver';
import { MarketplaceUrlValidationError } from './marketplace-url.validator';
import { loadImportInProgressSoftWindowMs } from './marketplace-import-job.config';

const GENERIC_RETRY_MESSAGE =
  'دریافت اطلاعات محصول موقتاً با مشکل مواجه شد. لطفاً کمی بعد دوباره تلاش کنید.';
const GENERIC_PERMANENT_MESSAGE = 'دریافت اطلاعات محصول با خطا مواجه شد.';

export function classifyMarketplaceImportFailure(
  error: unknown,
): MarketplaceImportFailureClassification {
  if (error instanceof MarketplaceUrlValidationError) {
    return permanent(error.code, error.message);
  }

  if (error instanceof MarketplaceRedirectError) {
    return permanent(error.code, error.message);
  }

  if (
    error instanceof MarketplaceImportQueueFullError ||
    error instanceof MarketplaceImportQueueTimeoutError
  ) {
    return retryable('IMPORT_BUSY', GENERIC_RETRY_MESSAGE);
  }

  if (error instanceof HttpException) {
    const status = error.getStatus();
    const response = error.getResponse() as any;
    const code = response?.data?.code || response?.code;
    const message =
      response?.messages?.[0] ||
      (typeof response?.message === 'string' ? response.message : undefined);

    if (code === 'IMPORT_IN_PROGRESS') {
      return retryable('IMPORT_IN_PROGRESS', message || GENERIC_RETRY_MESSAGE);
    }

    if (
      code === 'CRAWLER_TIMEOUT' ||
      code === 'SOURCE_TEMPORARILY_UNAVAILABLE'
    ) {
      return retryable(code, message || GENERIC_RETRY_MESSAGE);
    }

    if (status === 422 || status === 400) {
      return permanent(
        code || 'VALIDATION_FAILED',
        message || GENERIC_PERMANENT_MESSAGE,
      );
    }

    if (status === 429 || status === 503 || status === 504 || status === 502) {
      return retryable(
        code || `HTTP_${status}`,
        message || GENERIC_RETRY_MESSAGE,
      );
    }

    if (status >= 500) {
      return retryable(code || `HTTP_${status}`, GENERIC_RETRY_MESSAGE);
    }

    return permanent(
      code || `HTTP_${status}`,
      message || GENERIC_PERMANENT_MESSAGE,
    );
  }

  const axiosStatus = (error as any)?.response?.status;
  const axiosCode = (error as any)?.code;
  const axiosData = (error as any)?.response?.data;
  const axiosMessage =
    axiosData?.messages?.[0] ||
    axiosData?.message ||
    (error as Error | undefined)?.message;

  if (axiosStatus === 422 || axiosStatus === 400) {
    const code = axiosData?.code || axiosData?.data?.code;
    if (code === 'IMPORT_IN_PROGRESS') {
      return retryable('IMPORT_IN_PROGRESS', GENERIC_RETRY_MESSAGE);
    }
    if (
      code === 'CRAWLER_TIMEOUT' ||
      code === 'SOURCE_TEMPORARILY_UNAVAILABLE'
    ) {
      return retryable(code, GENERIC_RETRY_MESSAGE);
    }
    return permanent(
      code || 'CRAWLER_VALIDATION_FAILED',
      sanitizeMessage(axiosMessage) || 'لینک محصول معتبر نیست.',
    );
  }

  if (axiosStatus === 401 || axiosStatus === 403) {
    return permanent('CRAWLER_AUTH_FAILED', GENERIC_PERMANENT_MESSAGE);
  }

  if (
    axiosStatus === 429 ||
    axiosStatus === 503 ||
    axiosStatus === 504 ||
    axiosStatus === 502
  ) {
    const code = axiosData?.code || axiosData?.data?.code;
    return retryable(
      code || `CRAWLER_HTTP_${axiosStatus}`,
      GENERIC_RETRY_MESSAGE,
    );
  }

  if (axiosStatus >= 500) {
    return retryable(`CRAWLER_HTTP_${axiosStatus}`, GENERIC_RETRY_MESSAGE);
  }

  if (
    axiosCode === 'ECONNABORTED' ||
    axiosCode === 'ECONNREFUSED' ||
    axiosCode === 'ETIMEDOUT' ||
    String(error).includes('timeout')
  ) {
    return retryable('CRAWLER_UNAVAILABLE', GENERIC_RETRY_MESSAGE);
  }

  if (
    axiosCode === 'ER_LOCK_DEADLOCK' ||
    axiosCode === 'ER_LOCK_WAIT_TIMEOUT'
  ) {
    return retryable('DB_TEMPORARY', GENERIC_RETRY_MESSAGE);
  }

  if ((error as any)?.code === 'INVALID_CRAWLER_RESPONSE') {
    return permanent('INVALID_CRAWLER_RESPONSE', GENERIC_PERMANENT_MESSAGE);
  }

  return retryable('UNKNOWN', GENERIC_RETRY_MESSAGE);
}

export function computeMarketplaceImportRetryDelayMs(
  attemptCount: number,
  baseMs: number,
  maxMs: number,
): number {
  const exponent = Math.max(0, attemptCount - 1);
  const raw = Math.min(maxMs, baseMs * 2 ** exponent);
  const jitter = Math.floor(Math.random() * Math.min(baseMs, raw));
  return Math.min(maxMs, Math.max(0, raw + jitter));
}

/**
 * Soft-wait while another crawler owner holds the identity lease.
 * Soft window is derived from MARKETPLACE_IDENTITY_LEASE_MS (authoritative)
 * and optional MARKETPLACE_IMPORT_IN_PROGRESS_SOFT_WINDOW_MS (must be >= lease).
 * Use loadImportInProgressSoftWindowMs() for the effective bound.
 */
export const IMPORT_IN_PROGRESS_SOFT_RETRY_DELAY_MS = 45_000;
/** Default identity lease / soft window (ms). Prefer loadImportInProgressSoftWindowMs(). */
export const IMPORT_IN_PROGRESS_SOFT_WINDOW_MS = 600_000;

export function computeImportInProgressRetryDelayMs(
  baseMs: number,
  maxMs: number,
): number {
  const floor = IMPORT_IN_PROGRESS_SOFT_RETRY_DELAY_MS;
  const cappedMax = Math.max(maxMs, floor);
  return Math.min(cappedMax, Math.max(floor, baseMs));
}

export function shouldSoftRetryImportInProgress(
  errorCode: string,
  jobCreatedAt: Date,
  now: Date,
  softWindowMs: number = loadImportInProgressSoftWindowMs(),
): boolean {
  if (errorCode !== 'IMPORT_IN_PROGRESS') {
    return false;
  }
  const createdMs = jobCreatedAt.getTime();
  if (!Number.isFinite(createdMs)) {
    return false;
  }
  return now.getTime() - createdMs < softWindowMs;
}

function retryable(
  errorCode: string,
  errorMessage: string,
): MarketplaceImportFailureClassification {
  return {
    kind: 'retryable',
    errorCode,
    errorMessage: sanitizeMessage(errorMessage) || GENERIC_RETRY_MESSAGE,
  };
}

function permanent(
  errorCode: string,
  errorMessage: string,
): MarketplaceImportFailureClassification {
  return {
    kind: 'permanent',
    errorCode,
    errorMessage: sanitizeMessage(errorMessage) || GENERIC_PERMANENT_MESSAGE,
  };
}

function sanitizeMessage(message: unknown): string | null {
  if (typeof message !== 'string') {
    return null;
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > 500) {
    return trimmed.slice(0, 500);
  }

  const lowered = trimmed.toLowerCase();
  if (
    lowered.includes('econnrefused') ||
    lowered.includes('x-crawler-secret') ||
    lowered.includes('authorization') ||
    lowered.includes('stack')
  ) {
    return null;
  }

  return trimmed;
}
