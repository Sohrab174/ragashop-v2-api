import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrandEntity } from '../brand/entities/brand.entity';
import { CanonicalCategoryEntity } from '../catalog/entities/canonical-category.entity';
import { SourceCategoryMappingEntity } from '../catalog/entities/source-category-mapping.entity';
import { ProductEntity } from '../product/entities/product.entity';
import { SettingModule } from '../setting/setting.module';
import { BrandAliasEntity } from './entities/brand-alias.entity';
import { SearchService } from './search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      BrandEntity,
      BrandAliasEntity,
      CanonicalCategoryEntity,
      SourceCategoryMappingEntity,
    ]),
    SettingModule,
  ],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
