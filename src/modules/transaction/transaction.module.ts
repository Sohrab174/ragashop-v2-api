import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionEntity } from './entities/transaction.entity';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';
import { OrderEntity } from '../order/entities/order.entity';
import { ZarinpalModule } from '../../gateway/zarinpal/zarinpal.module';
import { ZibalModule } from '../../gateway/zibal/zibal.module';
import { PaypingModule } from '../../gateway/payping/payping.module';
import { OrderModule } from '../order/order.module';
import { GatewayModule } from '../gateway/gateway.module';
import { DpoPayModule } from '../../gateway/dpo-pay/dpo-pay.module';
import { SepGatewayModule } from '../../gateway/sep-gateway/sep-gateway.module';
import { BpmGatewayModule } from '../../gateway/bpm-gateway/bpm-gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionEntity, OrderEntity]),
    OrderModule,
    GatewayModule,
    ZarinpalModule,
    ZibalModule,
    PaypingModule,
    DpoPayModule,
    SepGatewayModule,
    BpmGatewayModule,
  ],
  controllers: [TransactionController],
  providers: [TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {}
