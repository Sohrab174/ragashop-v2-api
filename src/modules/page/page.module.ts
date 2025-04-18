import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PageEntity } from './entities/page.entity';
import { PageController } from './page.controller';
import { PageService } from './page.service';
import { PageSectionEntity } from './entities/page-section.entity';
import { PageSectionItemEntity } from './entities/page-section-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PageEntity,
      PageSectionEntity,
      PageSectionItemEntity,
    ]),
  ],
  controllers: [PageController],
  providers: [PageService],
  exports: [PageService],
})
export class PageModule {}
