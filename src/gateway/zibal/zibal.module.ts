import { Module } from '@nestjs/common';
import { ZibalService } from './zibal.service';

@Module({
  providers: [ZibalService],
  exports: [ZibalService],
})
export class ZibalModule {}
