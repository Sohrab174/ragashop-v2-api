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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      ProductGalleryEntity,
      ProductAttributeValueEntity,
    ]),
    CategoryModule,
    AttributeModule,
    CrawlerModule,
  ],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
