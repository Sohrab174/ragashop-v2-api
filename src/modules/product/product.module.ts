import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryModule } from '../category/category.module';
import { ProductGalleryEntity } from './entities/product-gallery.entity';
import { ProductEntity } from './entities/product.entity';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { AttributeModule } from '../attribute/attribute.module';
import { ProductAttributeValueEntity } from './entities/product-attribute-value.entity';
import { CrawlerModule } from '../../thirdParty/crawler/crawler.module';
import { ProductDescriptionEntity } from './entities/product-description.entity';
import { BrandModule } from '../brand/brand.module';
import { SettingModule } from '../setting/setting.module';
import { TranslatorModule } from '../../thirdParty/translator/translator.module';
import { FileStorageService } from '../../file-storage.service';
import { IncredibleOfferEntity } from '../incredible-offer/entities/Incredible-offer.entity';
import { CapabilityModule } from '../auth/capability/capability.module';
import { ProductChildMutationLockService } from './product-child-mutation-lock.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      ProductGalleryEntity,
      ProductAttributeValueEntity,
      ProductDescriptionEntity,
      IncredibleOfferEntity,
    ]),
    CategoryModule,
    AttributeModule,
    CrawlerModule,
    BrandModule,
    SettingModule,
    TranslatorModule,
    CapabilityModule,
  ],
  controllers: [ProductController],
  providers: [
    ProductService,
    FileStorageService,
    ProductChildMutationLockService,
  ],
  exports: [ProductService],
})
export class ProductModule {}
