import { Module } from '@nestjs/common';
import { AmootsmsService } from './amootsms.service';

@Module({
  providers: [AmootsmsService],
  exports: [AmootsmsService],
})
export class AmootsmsModule {}
