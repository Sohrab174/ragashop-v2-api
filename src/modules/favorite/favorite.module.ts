import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductFavoriteEntity } from './entities/product-favorite.entity';
import { FavoriteService } from './favorite.service';
import { FavoriteController } from './favorite.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ProductFavoriteEntity])],
  controllers: [FavoriteController],
  providers: [FavoriteService],
  exports: [FavoriteService],
})
export class FavoriteModule {}
