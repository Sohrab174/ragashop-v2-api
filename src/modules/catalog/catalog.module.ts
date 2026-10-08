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
import { CapabilityModule } from '../auth/capability/capability.module';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatMapV2cAdminService } from './cat-map-v2c-admin.service';
import { AssortmentPolicyRuleEntity } from './assortment-policy/entities/assortment-policy-rule.entity';
import { AssortmentPolicyAuditEntity } from './assortment-policy/entities/assortment-policy-audit.entity';
import { CategoryAssortmentResolutionEntity } from './assortment-policy/entities/category-assortment-resolution.entity';
import { AssortmentPolicyStateEntity } from './assortment-policy/entities/assortment-policy-state.entity';
import { AssortmentPolicyRuleService } from './assortment-policy/assortment-policy.rule.service';
import { AssortmentPolicyRecomputeService } from './assortment-policy/assortment-policy.recompute.service';
import { AssortmentPolicyAdminService } from './assortment-policy/assortment-policy.admin.service';
import { AssortmentAutoMapService } from './assortment-policy/assortment-auto-map.service';
import { AssortmentPolicySnapshotService } from './assortment-policy/assortment-policy-snapshot.service';
import { AssortmentCommerceService } from './assortment-policy/assortment-commerce.service';

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
      AssortmentPolicyRuleEntity,
      AssortmentPolicyAuditEntity,
      CategoryAssortmentResolutionEntity,
      AssortmentPolicyStateEntity,
    ]),
    SettingModule,
    SearchModule,
    CapabilityModule,
  ],
  controllers: [CatalogController],
  providers: [
    CatalogService,
    CatMapV2cAdminService,
    AssortmentPolicyRuleService,
    AssortmentPolicyRecomputeService,
    AssortmentPolicyAdminService,
    AssortmentAutoMapService,
    AssortmentPolicySnapshotService,
    AssortmentCommerceService,
  ],
  exports: [
    CatalogService,
    CatMapV2cAdminService,
    AssortmentPolicyRuleService,
    AssortmentPolicyRecomputeService,
    AssortmentPolicyAdminService,
    AssortmentAutoMapService,
    AssortmentPolicySnapshotService,
    AssortmentCommerceService,
  ],
})
export class CatalogModule {}
