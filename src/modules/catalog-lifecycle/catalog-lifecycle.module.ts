import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '../product/entities/product.entity';
import { CartItemEntity } from '../cart/entities/cart-item.entity';
import { MarketplaceImportModule } from '../marketplace-import/marketplace-import.module';
import { MarketplaceImportJobEntity } from '../marketplace-import/entities/marketplace-import-job.entity';
import { CatalogLifecycleController } from './catalog-lifecycle.controller';
import { CatalogRefreshExecutorService } from './catalog-refresh-executor.service';
import { CatalogRefreshCheckpointEntity } from './entities/catalog-refresh-checkpoint.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      MarketplaceImportJobEntity,
      CartItemEntity,
      CatalogRefreshCheckpointEntity,
    ]),
    MarketplaceImportModule,
  ],
  controllers: [CatalogLifecycleController],
  providers: [CatalogRefreshExecutorService],
  exports: [CatalogRefreshExecutorService],
})
export class CatalogLifecycleModule {}
