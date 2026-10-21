import { Module, forwardRef } from '@nestjs/common';
import { CommonController } from './common.controller';
import { CommonService } from './common.service';
import { StorefrontHomeModule } from '../storefront-home/storefront-home.module';

@Module({
  imports: [forwardRef(() => StorefrontHomeModule)],
  controllers: [CommonController],
  providers: [CommonService],
  exports: [CommonService],
})
export class CommonModule {}
