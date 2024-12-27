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
import { SpotplayerModule } from '../../thirdParty/spotplayer/spotplayer.module';
// import { AmootsmsModule } from '../../sms/amootsms/amootsms.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderEntity, OrderItemEntity]),
    ProductModule,
    MailModule,
    KavenegarModule,
    DiscountCouponModule,
    CustomerModule,
    SpotplayerModule,
    // AmootsmsModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
