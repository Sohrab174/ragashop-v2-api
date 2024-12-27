import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SliderEntity } from './entities/slider.entity';
import { SliderController } from './slider.controller';
import { SliderService } from './slider.service';

@Module({
  imports: [TypeOrmModule.forFeature([SliderEntity])],
  controllers: [SliderController],
  providers: [SliderService],
  exports: [SliderService],
})
export class SliderModule {}
