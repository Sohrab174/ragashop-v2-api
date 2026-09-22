import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ErrorModule } from '../../error/error.module';
import { SettingModule } from '../setting/setting.module';
import { ProductModule } from '../product/product.module';
import { CartModule } from '../cart/cart.module';
import { CityModule } from '../city/city.module';
import { CartEntity } from '../cart/entities/cart.entity';
import { CartItemEntity } from '../cart/entities/cart-item.entity';
import { OrderEntity } from '../order/entities/order.entity';
import { OrderItemEntity } from '../order/entities/order-item.entity';
import { ProductEntity } from '../product/entities/product.entity';
import { CityEntity } from '../city/entities/city.entity';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CartEntity,
      CartItemEntity,
      OrderEntity,
      OrderItemEntity,
      ProductEntity,
      CityEntity,
    ]),
    ErrorModule,
    SettingModule,
    ProductModule,
    CartModule,
    CityModule,
  ],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
