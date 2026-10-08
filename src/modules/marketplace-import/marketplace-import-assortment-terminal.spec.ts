import { MarketplaceImportJobWorkerService } from './marketplace-import-job-worker.service';
import { MarketplaceImportJobStatus } from './marketplace-import-job.types';
import { classifyMarketplaceImportFailure } from './marketplace-import-failure-classifier';
import { toCustomerSafeImportError } from './marketplace-import-customer-errors';

/**
 * SCOPE-5/6 paste-link human-review blocker regression.
 *
 * Every assortment outcome of a customer paste-link must drive the job to a
 * TERMINAL status (succeeded | failed) on the first attempt — never
 * retry_wait / processing — and the public status must carry the fixed
 * customer wording the storefront renders.
 */
const REVIEW_MESSAGE = 'امکان خرید و ارسال این کالا نیاز به بررسی دارد.';
const OUT_MESSAGE = 'این کالا در حال حاضر از طریق راگاشاپ قابل سفارش نیست.';

function crawlerRejection(code: string, message: string) {
  // Shape of an axios error from POST /product/search on the crawler.
  return Object.assign(new Error('Request failed with status code 400'), {
    response: {
      status: 400,
      data: { success: false, messages: [message], data: { code } },
    },
  });
}

function createWorker(crawler: { result?: { id: number; name: string }; error?: unknown }) {
  const job = {
    id: 253,
    source: 'trendyol',
    sourceProductId: '826520529',
    canonicalSourceUrl: 'https://www.trendyol.com/p/product-p-826520529',
    requestType: 'customer',
    status: MarketplaceImportJobStatus.processing,
  };
  const jobService = {
    getProcessingJob: jest.fn().mockResolvedValue(job),
    reconcileSucceededProduct: jest.fn().mockResolvedValue(true),
    markJobSucceeded: jest.fn().mockResolvedValue(true),
    markJobFailed: jest.fn().mockResolvedValue(true),
    // Real production classifier — no mock shortcut.
    classifyFailure: jest.fn((e: unknown) => classifyMarketplaceImportFailure(e)),
  };
  const crawlerClient = {
    importProduct: crawler.error
      ? jest.fn().mockRejectedValue(crawler.error)
      : jest.fn().mockResolvedValue(crawler.result),
  };
  const concurrencyGate = {
    acquire: jest.fn().mockResolvedValue({ release: jest.fn() }),
    getMaxConcurrent: jest.fn().mockReturnValue(3),
  };
  const query = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
  };
  const productRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(query),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    manager: { query: jest.fn().mockResolvedValue([{ status: 'REVIEW_REQUIRED' }]) },
  };
  const worker = new MarketplaceImportJobWorkerService(
    jobService as any,
    crawlerClient as any,
    concurrencyGate as any,
    productRepository as any,
  );
  return { worker, jobService };
}

describe('SCOPE-5/6 paste-link assortment outcomes are terminal', () => {
  it('REVIEW: crawler persists review evidence → job succeeded with productId', async () => {
    const { worker, jobService } = createWorker({
      result: { id: 74221, name: 'Halı' },
    });
    await worker.processClaimedJob(253, 'claim');
    expect(jobService.markJobSucceeded).toHaveBeenCalledWith(253, 'claim', 74221);
    expect(jobService.markJobFailed).not.toHaveBeenCalled();
  });

  it.each([['UNKNOWN category'], ['policy unavailable'], ['policy stale']])(
    '%s: review evidence → job succeeded (terminal, never retry_wait)',
    async () => {
      const { worker, jobService } = createWorker({
        result: { id: 501, name: 'Review' },
      });
      await worker.processClaimedJob(253, 'claim');
      expect(jobService.markJobSucceeded).toHaveBeenCalledWith(253, 'claim', 501);
      expect(jobService.markJobFailed).not.toHaveBeenCalled();
    },
  );

  it('IN: normal import still succeeds', async () => {
    const { worker, jobService } = createWorker({ result: { id: 2, name: 'IN' } });
    await worker.processClaimedJob(253, 'claim');
    expect(jobService.markJobSucceeded).toHaveBeenCalledWith(253, 'claim', 2);
  });

  it('OUT: crawler rejection → permanent failure (no retry) with OUT customer wording', async () => {
    const { worker, jobService } = createWorker({
      error: crawlerRejection('ASSORTMENT_OUT_OF_SCOPE', OUT_MESSAGE),
    });
    await worker.processClaimedJob(253, 'claim');
    expect(jobService.markJobSucceeded).not.toHaveBeenCalled();
    expect(jobService.markJobFailed).toHaveBeenCalledWith(
      253,
      'claim',
      'ASSORTMENT_OUT_OF_SCOPE',
      expect.any(String),
      false,
    );
    expect(toCustomerSafeImportError('ASSORTMENT_OUT_OF_SCOPE', 'internal')).toEqual({
      code: 'PRODUCT_NOT_ORDERABLE',
      message: OUT_MESSAGE,
    });
  });

  it('CATEGORY_OUT_OF_SCOPE backend result → exact OUT customer message', async () => {
    const { worker, jobService } = createWorker({
      error: crawlerRejection('CATEGORY_OUT_OF_SCOPE', 'internal policy text'),
    });
    await worker.processClaimedJob(253, 'claim');
    expect(jobService.markJobFailed).toHaveBeenCalledWith(
      253,
      'claim',
      'CATEGORY_OUT_OF_SCOPE',
      expect.any(String),
      false,
    );
    expect(toCustomerSafeImportError('CATEGORY_OUT_OF_SCOPE', 'internal policy text')).toEqual({
      code: 'PRODUCT_NOT_ORDERABLE',
      message: OUT_MESSAGE,
    });
  });

  it('genuine crawler failure (IMPORT_FAILED) stays a generic failure, never OUT', async () => {
    const { worker, jobService } = createWorker({
      error: crawlerRejection('IMPORT_FAILED', 'دریافت اطلاعات محصول با خطا مواجه شد.'),
    });
    await worker.processClaimedJob(253, 'claim');
    expect(jobService.markJobFailed).toHaveBeenCalledWith(
      253,
      'claim',
      'IMPORT_FAILED',
      expect.any(String),
      false,
    );
    const publicError = toCustomerSafeImportError('IMPORT_FAILED', null);
    expect(publicError.code).toBe('IMPORT_FAILED');
    expect(publicError.message).not.toBe(OUT_MESSAGE);
    expect(publicError.message).not.toBe(REVIEW_MESSAGE);
  });

  it('parser rejection (INVALID_PRODUCT_DATA) stays INVALID_PRODUCT_DATA, never OUT', async () => {
    const { worker, jobService } = createWorker({
      error: crawlerRejection('INVALID_PRODUCT_DATA', 'اطلاعات محصول معتبر نیست.'),
    });
    await worker.processClaimedJob(253, 'claim');
    expect(jobService.markJobFailed).toHaveBeenCalledWith(
      253,
      'claim',
      'INVALID_PRODUCT_DATA',
      expect.any(String),
      false,
    );
    expect(toCustomerSafeImportError('INVALID_PRODUCT_DATA', null).code).toBe(
      'INVALID_PRODUCT_DATA',
    );
  });

  it('crawler unreachable stays retryable technical failure, never OUT', async () => {
    const { worker, jobService } = createWorker({
      error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    await worker.processClaimedJob(253, 'claim');
    expect(jobService.markJobFailed).toHaveBeenCalledWith(
      253,
      'claim',
      'CRAWLER_UNAVAILABLE',
      expect.any(String),
      true,
    );
    expect(toCustomerSafeImportError('CRAWLER_UNAVAILABLE', null).code).toBe(
      'SOURCE_TEMPORARILY_UNAVAILABLE',
    );
  });

  it('REVIEW rejection code (defensive) → permanent failure with REVIEW wording', async () => {
    const { worker, jobService } = createWorker({
      error: crawlerRejection('ASSORTMENT_REVIEW_REQUIRED', REVIEW_MESSAGE),
    });
    await worker.processClaimedJob(253, 'claim');
    expect(jobService.markJobFailed).toHaveBeenCalledWith(
      253,
      'claim',
      'ASSORTMENT_REVIEW_REQUIRED',
      expect.any(String),
      false,
    );
    for (const code of [
      'ASSORTMENT_REVIEW_REQUIRED',
      'CATEGORY_REVIEW_REQUIRED',
      'ASSORTMENT_UNRESOLVED',
      'POLICY_UNAVAILABLE',
      'POLICY_STALE',
    ]) {
      expect(toCustomerSafeImportError(code, 'internal')).toEqual({
        code: 'PRODUCT_REVIEW_REQUIRED',
        message: REVIEW_MESSAGE,
      });
    }
  });
});
