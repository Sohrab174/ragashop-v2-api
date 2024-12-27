import { Module } from '@nestjs/common';
import { SpotplayerService } from './spotplayer.service';

@Module({
  providers: [SpotplayerService],
  exports: [SpotplayerService],
})
export class SpotplayerModule {}
