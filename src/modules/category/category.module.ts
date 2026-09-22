import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { CategoryEntity } from './entities/category.entity';
import { TranslatorModule } from '../../thirdParty/translator/translator.module';
import { CategoryHierarchyLockService } from './category-hierarchy-lock.service';

@Module({
  imports: [TypeOrmModule.forFeature([CategoryEntity]), TranslatorModule],
  controllers: [CategoryController],
  providers: [CategoryService, CategoryHierarchyLockService],
  exports: [CategoryService],
})
export class CategoryModule {}
