import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrandEntity } from './entities/brand.entity';
import { BrandController } from './brand.controller';
import { BrandService } from './brand.service';
import { TranslatorModule } from '../../thirdParty/translator/translator.module';
import { CapabilityModule } from '../auth/capability/capability.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BrandEntity]),
    TranslatorModule,
    CapabilityModule,
  ],
  controllers: [BrandController],
  providers: [BrandService],
  exports: [BrandService],
})
export class BrandModule {}
