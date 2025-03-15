import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CityEntity } from './entities/city.entity';
import { CityController } from './city.controller';
import { CityService } from './city.service';
import { ProvinceEntity } from './entities/province.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CityEntity, ProvinceEntity])],
  controllers: [CityController],
  providers: [CityService],
  exports: [CityService],
})
export class CityModule {}
