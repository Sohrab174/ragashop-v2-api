import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IncredibleOfferEntity } from './entities/Incredible-offer.entity';
import { IncredibleOffersController } from './Incredible-offer.controller';
import { IncredibleOfferService } from './Incredible-offer.service';
import { ProductModule } from '../product/product.module';

@Module({
  imports: [TypeOrmModule.forFeature([IncredibleOfferEntity]), ProductModule],
  controllers: [IncredibleOffersController],
  providers: [IncredibleOfferService],
  exports: [IncredibleOfferService],
})
export class IncredibleOfferModule {}
