import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '../product/entities/product.entity';
import { CategoryEntity } from '../category/entities/category.entity';
import { CanonicalCategoryEntity } from '../catalog/entities/canonical-category.entity';
import { StorefrontHomeSectionEntity } from './entities/storefront-home-section.entity';
import { StorefrontHomeController } from './storefront-home.controller';
import { StorefrontHomeService } from './storefront-home.service';
import { CapabilityModule } from '../auth/capability/capability.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorefrontHomeSectionEntity,
      ProductEntity,
      CategoryEntity,
      CanonicalCategoryEntity,
    ]),
    CapabilityModule,
  ],
  controllers: [StorefrontHomeController],
  providers: [StorefrontHomeService],
  exports: [StorefrontHomeService],
})
export class StorefrontHomeModule {}
