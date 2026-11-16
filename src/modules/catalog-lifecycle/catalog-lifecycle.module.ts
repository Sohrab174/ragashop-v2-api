import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '../product/entities/product.entity';
import { CartItemEntity } from '../cart/entities/cart-item.entity';
import { MarketplaceImportModule } from '../marketplace-import/marketplace-import.module';
import { MarketplaceImportJobEntity } from '../marketplace-import/entities/marketplace-import-job.entity';
import { CatalogLifecycleController } from './catalog-lifecycle.controller';
import { CatalogRefreshExecutorService } from './catalog-refresh-executor.service';
import { CatalogRefreshCheckpointEntity } from './entities/catalog-refresh-checkpoint.entity';
import { ShowcasePilotRefreshService } from './showcase-pilot-refresh.service';
import { DiscountEngineService } from './discount-engine.service';
import { DiscountEngineScheduler } from './discount-engine.scheduler';
import { DiscountDiscoveryPoolEntity } from './entities/discount-discovery-pool.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      MarketplaceImportJobEntity,
      CartItemEntity,
      CatalogRefreshCheckpointEntity,
      DiscountDiscoveryPoolEntity,
    ]),
    MarketplaceImportModule,
  ],
  controllers: [CatalogLifecycleController],
  providers: [
    CatalogRefreshExecutorService,
    ShowcasePilotRefreshService,
    DiscountEngineService,
    DiscountEngineScheduler,
  ],
  exports: [
    CatalogRefreshExecutorService,
    ShowcasePilotRefreshService,
    DiscountEngineService,
    DiscountEngineScheduler,
  ],
})
export class CatalogLifecycleModule {}
