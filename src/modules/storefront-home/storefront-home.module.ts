import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '../product/entities/product.entity';
import { CategoryEntity } from '../category/entities/category.entity';
import { CanonicalCategoryEntity } from '../catalog/entities/canonical-category.entity';
import { StorefrontHomeSectionEntity } from './entities/storefront-home-section.entity';
import { StorefrontHomeSectionInstanceEntity } from './entities/storefront-home-section-instance.entity';
import { StorefrontHomeController } from './storefront-home.controller';
import { StorefrontHomeService } from './storefront-home.service';
import { HomeImageAccessService } from './home-image-access.service';
import { CapabilityModule } from '../auth/capability/capability.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorefrontHomeSectionEntity,
      StorefrontHomeSectionInstanceEntity,
      ProductEntity,
      CategoryEntity,
      CanonicalCategoryEntity,
    ]),
    CapabilityModule,
  ],
  controllers: [StorefrontHomeController],
  providers: [StorefrontHomeService, HomeImageAccessService],
  exports: [StorefrontHomeService, HomeImageAccessService],
})
export class StorefrontHomeModule {}
