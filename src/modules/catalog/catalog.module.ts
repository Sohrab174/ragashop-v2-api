import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CanonicalCategoryEntity } from './entities/canonical-category.entity';
import { SourceCategoryMappingEntity } from './entities/source-category-mapping.entity';
import { ProductEntity } from '../product/entities/product.entity';
import { ProductGalleryEntity } from '../product/entities/product-gallery.entity';
import { ProductDescriptionEntity } from '../product/entities/product-description.entity';
import { ProductAttributeValueEntity } from '../product/entities/product-attribute-value.entity';
import { CategoryEntity } from '../category/entities/category.entity';
import { SettingModule } from '../setting/setting.module';
import { SearchModule } from '../search/search.module';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CanonicalCategoryEntity,
      SourceCategoryMappingEntity,
      ProductEntity,
      ProductGalleryEntity,
      ProductDescriptionEntity,
      ProductAttributeValueEntity,
      CategoryEntity,
    ]),
    SettingModule,
    SearchModule,
  ],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
