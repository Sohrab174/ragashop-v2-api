import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductFavoriteEntity } from './entities/product-favorite.entity';
import { FavoriteService } from './favorite.service';
import { FavoriteController } from './favorite.controller';
import { ProductEntity } from '../product/entities/product.entity';
import { ErrorModule } from '../../error/error.module';
import { FavoriteLockService } from './favorite-lock.service';
import { ProductChildMutationLockService } from '../product/product-child-mutation-lock.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductFavoriteEntity, ProductEntity]),
    ErrorModule,
  ],
  controllers: [FavoriteController],
  providers: [
    FavoriteService,
    FavoriteLockService,
    ProductChildMutationLockService,
  ],
  exports: [FavoriteService],
})
export class FavoriteModule {}
