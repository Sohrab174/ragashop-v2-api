import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from '../order/entities/order.entity';
import { CapabilityModule } from '../auth/capability/capability.module';
import { SupportRequestEntity } from './entities/support-request.entity';
import { SupportMessageEntity } from './entities/support-message.entity';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';

/**
 * Attachments are out of SUPPORT-1 scope.
 * A later attachment path must reuse private receipt storage, not a public upload folder.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupportRequestEntity,
      SupportMessageEntity,
      OrderEntity,
    ]),
    CapabilityModule,
  ],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
