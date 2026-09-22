import { MarketplaceImportJobStatus } from './marketplace-import-job.types';

export class MarketplaceImportJobStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketplaceImportJobStateError';
  }
}

const ALLOWED_TRANSITIONS: Record<
  MarketplaceImportJobStatus,
  MarketplaceImportJobStatus[]
> = {
  [MarketplaceImportJobStatus.queued]: [
    MarketplaceImportJobStatus.processing,
    MarketplaceImportJobStatus.succeeded,
    MarketplaceImportJobStatus.failed,
  ],
  [MarketplaceImportJobStatus.retry_wait]: [
    MarketplaceImportJobStatus.processing,
    MarketplaceImportJobStatus.succeeded,
    MarketplaceImportJobStatus.failed,
  ],
  [MarketplaceImportJobStatus.processing]: [
    MarketplaceImportJobStatus.succeeded,
    MarketplaceImportJobStatus.failed,
    MarketplaceImportJobStatus.retry_wait,
    MarketplaceImportJobStatus.queued,
  ],
  [MarketplaceImportJobStatus.succeeded]: [],
  [MarketplaceImportJobStatus.failed]: [],
};

export function assertMarketplaceImportJobTransition(
  from: MarketplaceImportJobStatus,
  to: MarketplaceImportJobStatus,
): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new MarketplaceImportJobStateError(
      `Invalid marketplace import job transition: ${from} -> ${to}`,
    );
  }
}

export function isActiveMarketplaceImportJobStatus(
  status: MarketplaceImportJobStatus,
): boolean {
  return (
    status === MarketplaceImportJobStatus.queued ||
    status === MarketplaceImportJobStatus.processing ||
    status === MarketplaceImportJobStatus.retry_wait
  );
}

export function shouldRetainActiveDedupKey(
  status: MarketplaceImportJobStatus,
): boolean {
  return isActiveMarketplaceImportJobStatus(status);
}
