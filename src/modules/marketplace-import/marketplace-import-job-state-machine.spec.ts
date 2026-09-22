import {
  assertMarketplaceImportJobTransition,
  MarketplaceImportJobStateError,
} from './marketplace-import-job-state-machine';
import { MarketplaceImportJobStatus } from './marketplace-import-job.types';

describe('MarketplaceImportJobStateMachine', () => {
  it('allows queued -> processing', () => {
    expect(() =>
      assertMarketplaceImportJobTransition(
        MarketplaceImportJobStatus.queued,
        MarketplaceImportJobStatus.processing,
      ),
    ).not.toThrow();
  });

  it('allows processing -> retry_wait', () => {
    expect(() =>
      assertMarketplaceImportJobTransition(
        MarketplaceImportJobStatus.processing,
        MarketplaceImportJobStatus.retry_wait,
      ),
    ).not.toThrow();
  });

  it('rejects succeeded -> processing', () => {
    expect(() =>
      assertMarketplaceImportJobTransition(
        MarketplaceImportJobStatus.succeeded,
        MarketplaceImportJobStatus.processing,
      ),
    ).toThrow(MarketplaceImportJobStateError);
  });

  it('rejects failed -> queued', () => {
    expect(() =>
      assertMarketplaceImportJobTransition(
        MarketplaceImportJobStatus.failed,
        MarketplaceImportJobStatus.queued,
      ),
    ).toThrow(MarketplaceImportJobStateError);
  });
});
