import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '../product/entities/product.entity';
import { CrawlerClientService } from './crawler-client.service';
import { MarketplaceImportJobEntity } from './entities/marketplace-import-job.entity';
import { MarketplaceImportCoalescer } from './marketplace-import-coalescer';
import {
  MarketplaceImportConcurrencyGate,
  MARKETPLACE_IMPORT_CONCURRENCY_OPTIONS,
} from './marketplace-import-concurrency';
import { MarketplaceImportController } from './marketplace-import.controller';
import { MarketplaceImportJobService } from './marketplace-import-job.service';
import { MarketplaceImportJobWorkerService } from './marketplace-import-job-worker.service';
import {
  MarketplaceImportRateLimiter,
  MARKETPLACE_IMPORT_RATE_LIMITER_OPTIONS,
} from './marketplace-import-rate-limiter';
import { MarketplaceImportService } from './marketplace-import.service';
import {
  MarketplaceRedirectResolver,
  MARKETPLACE_REDIRECT_RESOLVER_OPTIONS,
} from './marketplace-redirect.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductEntity, MarketplaceImportJobEntity]),
  ],
  controllers: [MarketplaceImportController],
  providers: [
    MarketplaceImportService,
    MarketplaceImportJobService,
    MarketplaceImportJobWorkerService,
    {
      provide: MARKETPLACE_REDIRECT_RESOLVER_OPTIONS,
      useValue: {},
    },
    MarketplaceRedirectResolver,
    CrawlerClientService,
    {
      provide: MARKETPLACE_IMPORT_RATE_LIMITER_OPTIONS,
      useValue: {},
    },
    MarketplaceImportRateLimiter,
    MarketplaceImportCoalescer,
    {
      provide: MARKETPLACE_IMPORT_CONCURRENCY_OPTIONS,
      useValue: {},
    },
    MarketplaceImportConcurrencyGate,
  ],
  exports: [
    MarketplaceImportService,
    MarketplaceImportJobService,
    CrawlerClientService,
  ],
})
export class MarketplaceImportModule {}
