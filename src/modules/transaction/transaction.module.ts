import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionEntity } from './entities/transaction.entity';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';
import { OrderEntity } from '../order/entities/order.entity';
import { PaypingModule } from '../../gateway/payping/payping.module';
import { OrderModule } from '../order/order.module';
import { GatewayModule } from '../gateway/gateway.module';
import { SettingModule } from '../setting/setting.module';
import { CustomerModule } from '../customer/customer.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionEntity, OrderEntity]),
    OrderModule,
    GatewayModule,
    PaypingModule,
    SettingModule,
    CustomerModule,
  ],
  controllers: [TransactionController],
  providers: [TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {}
