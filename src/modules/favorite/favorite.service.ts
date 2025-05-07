import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import { ProductFavoriteEntity } from './entities/product-favorite.entity';
import { CustomerEntity } from '../customer/entities/customer.entity';

@Injectable()
export class FavoriteService {
  constructor(
    @InjectRepository(ProductFavoriteEntity)
    private productFavoriteRepository: Repository<ProductFavoriteEntity>,

    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * PUT /favorites/product/:productId/me
   */
  async addDeleteProduct(productId: number, customer: CustomerEntity) {
    const favorite = await this.productFavoriteRepository
      .createQueryBuilder()
      .select(['id'])
      .where({ productId, customerId: customer.id, isDeleted: false })
      .getRawOne();

    if (favorite) {
      await this.productFavoriteRepository
        .createQueryBuilder()
        .update()
        .set({ isDeleted: true })
        .where({ id: favorite.id })
        .execute();

      return false;
    }

    await this.productFavoriteRepository
      .createQueryBuilder()
      .insert()
      .values({
        productId,
        customerId: customer.id,
        createdAt: new Date(),
      })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * GET /favorites/products/me
   */
  async getProducts(customer: CustomerEntity) {
    const list = await this.productFavoriteRepository
      .createQueryBuilder()
      .select(['id', 'productId'])
      .where({ customerId: customer.id, isDeleted: false })
      .getRawMany();

    return list.map((item) => item.productId);
  }
}
