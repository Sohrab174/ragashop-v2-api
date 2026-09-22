export enum MarketplaceImportJobStatus {
  queued = 'queued',
  processing = 'processing',
  retry_wait = 'retry_wait',
  succeeded = 'succeeded',
  failed = 'failed',
}

export enum MarketplaceImportRequestType {
  customer = 'customer',
  admin = 'admin',
  scheduled = 'scheduled',
}

export const ACTIVE_MARKETPLACE_IMPORT_JOB_STATUSES: MarketplaceImportJobStatus[] =
  [
    MarketplaceImportJobStatus.queued,
    MarketplaceImportJobStatus.processing,
    MarketplaceImportJobStatus.retry_wait,
  ];

export const TERMINAL_MARKETPLACE_IMPORT_JOB_STATUSES: MarketplaceImportJobStatus[] =
  [MarketplaceImportJobStatus.succeeded, MarketplaceImportJobStatus.failed];

export type MarketplaceImportFailureKind = 'retryable' | 'permanent';

export interface MarketplaceImportFailureClassification {
  kind: MarketplaceImportFailureKind;
  errorCode: string;
  errorMessage: string;
}

export interface MarketplaceImportJobPublicStatus {
  jobId: number;
  status: MarketplaceImportJobStatus;
  productId?: number;
  productName?: string;
  errorCode?: string;
  errorMessage?: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failedAt?: string;
}

export interface MarketplaceImportAcceptedJob {
  jobId: number;
  accessToken: string;
  status: MarketplaceImportJobStatus;
}

export type MarketplaceImportCreateResult =
  | { kind: 'product'; id: number; name: string }
  | { kind: 'job'; job: MarketplaceImportAcceptedJob };
