import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ErrorModule } from '../../error/error.module';
import { SettingModule } from '../setting/setting.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ProductEntity } from '../product/entities/product.entity';
import { CartEntity } from './entities/cart.entity';
import { CartItemEntity } from './entities/cart-item.entity';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([CartEntity, CartItemEntity, ProductEntity]),
    ErrorModule,
    SettingModule,
    CatalogModule,
  ],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
