import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductModule } from '../product/product.module';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderEntity } from './entities/order.entity';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { MailModule } from '../../mail/mail.module';
import { KavenegarModule } from '../../sms/kavenegar/kavenegar.module';
import { DiscountCouponModule } from '../discount-coupon/discount-coupon.module';
import { CustomerModule } from '../customer/customer.module';
import { OrderStatusEntity } from './entities/order-status.entity';
import { AddressModule } from '../address/address.module';
// import { AmootsmsModule } from '../../sms/amootsms/amootsms.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderEntity, OrderItemEntity, OrderStatusEntity]),
    ProductModule,
    MailModule,
    KavenegarModule,
    DiscountCouponModule,
    CustomerModule,
    AddressModule,
    // AmootsmsModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
