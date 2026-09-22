import { HttpException, HttpStatus } from '@nestjs/common';
import {
  classifyMarketplaceImportFailure,
  computeImportInProgressRetryDelayMs,
  computeMarketplaceImportRetryDelayMs,
  IMPORT_IN_PROGRESS_SOFT_RETRY_DELAY_MS,
  shouldSoftRetryImportInProgress,
} from './marketplace-import-failure-classifier';
import { MarketplaceUrlValidationError } from './marketplace-url.validator';

describe('MarketplaceImportFailureClassifier', () => {
  it('classifies validation errors as permanent', () => {
    const result = classifyMarketplaceImportFailure(
      new MarketplaceUrlValidationError('INVALID_URL', 'invalid'),
    );
    expect(result.kind).toBe('permanent');
    expect(result.errorCode).toBe('INVALID_URL');
  });

  it('classifies crawler timeout as retryable', () => {
    const result = classifyMarketplaceImportFailure({ code: 'ECONNABORTED' });
    expect(result.kind).toBe('retryable');
  });

  it('classifies crawler SOURCE_UNAVAILABLE as permanent', () => {
    const result = classifyMarketplaceImportFailure({
      response: {
        status: 400,
        data: {
          messages: ['محصولی یافت نشد!'],
          data: { code: 'SOURCE_UNAVAILABLE' },
        },
      },
    });
    expect(result.kind).toBe('permanent');
    expect(result.errorCode).toBe('SOURCE_UNAVAILABLE');
  });

  it('classifies invalid product data as permanent', () => {
    const result = classifyMarketplaceImportFailure({
      response: {
        status: 400,
        data: { data: { code: 'INVALID_PRODUCT_DATA' } },
      },
    });
    expect(result.kind).toBe('permanent');
    expect(result.errorCode).toBe('INVALID_PRODUCT_DATA');
  });

  it('classifies 503 http exception as retryable', () => {
    const result = classifyMarketplaceImportFailure(
      new HttpException('busy', HttpStatus.SERVICE_UNAVAILABLE),
    );
    expect(result.kind).toBe('retryable');
  });

  it('classifies crawler auth errors as permanent', () => {
    const result = classifyMarketplaceImportFailure({
      response: { status: 401, data: {} },
    });
    expect(result.kind).toBe('permanent');
  });

  it('classifies import in progress as retryable', () => {
    const result = classifyMarketplaceImportFailure({
      response: { status: 400, data: { code: 'IMPORT_IN_PROGRESS' } },
    });
    expect(result.kind).toBe('retryable');
    expect(result.errorCode).toBe('IMPORT_IN_PROGRESS');
  });

  it('soft-retries IMPORT_IN_PROGRESS within identity lease window', () => {
    const created = new Date('2026-09-13T10:00:00.000Z');
    const softWindowMs = 600_000;
    expect(
      shouldSoftRetryImportInProgress(
        'IMPORT_IN_PROGRESS',
        created,
        new Date('2026-09-13T10:05:00.000Z'),
        softWindowMs,
      ),
    ).toBe(true);
    expect(
      shouldSoftRetryImportInProgress(
        'IMPORT_IN_PROGRESS',
        created,
        new Date('2026-09-13T10:11:00.000Z'),
        softWindowMs,
      ),
    ).toBe(false);
    expect(
      shouldSoftRetryImportInProgress(
        'CRAWLER_UNAVAILABLE',
        created,
        new Date('2026-09-13T10:01:00.000Z'),
        softWindowMs,
      ),
    ).toBe(false);
  });

  it('classifies crawler timeout 503 contract as retryable with typed code', () => {
    const result = classifyMarketplaceImportFailure({
      response: {
        status: 503,
        data: {
          messages: ['busy'],
          data: { code: 'CRAWLER_TIMEOUT' },
        },
      },
    });
    expect(result.kind).toBe('retryable');
    expect(result.errorCode).toBe('CRAWLER_TIMEOUT');
  });

  it('classifies SOURCE_TEMPORARILY_UNAVAILABLE as retryable', () => {
    const result = classifyMarketplaceImportFailure({
      response: {
        status: 503,
        data: { data: { code: 'SOURCE_TEMPORARILY_UNAVAILABLE' } },
      },
    });
    expect(result.kind).toBe('retryable');
    expect(result.errorCode).toBe('SOURCE_TEMPORARILY_UNAVAILABLE');
  });

  it('uses a long floor delay for IMPORT_IN_PROGRESS soft waits', () => {
    const delay = computeImportInProgressRetryDelayMs(5000, 120000);
    expect(delay).toBeGreaterThanOrEqual(IMPORT_IN_PROGRESS_SOFT_RETRY_DELAY_MS);
    expect(delay).toBeLessThanOrEqual(120000);
  });

  it('caps jittered backoff at maxMs', () => {
    const delay = computeMarketplaceImportRetryDelayMs(4, 5000, 120000);
    expect(delay).toBeGreaterThanOrEqual(5000);
    expect(delay).toBeLessThanOrEqual(125000);
  });

  it('keeps INVALID_PRODUCT_DATA and SOURCE_UNAVAILABLE permanent', () => {
    expect(
      classifyMarketplaceImportFailure({
        response: {
          status: 400,
          data: { data: { code: 'INVALID_PRODUCT_DATA' } },
        },
      }).kind,
    ).toBe('permanent');
    expect(
      classifyMarketplaceImportFailure({
        response: {
          status: 400,
          data: { data: { code: 'SOURCE_UNAVAILABLE' } },
        },
      }).kind,
    ).toBe('permanent');
  });
});
