import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import { ProductFavoriteEntity } from './entities/product-favorite.entity';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { ProductEntity } from '../product/entities/product.entity';
import { isCustomerVisibleProduct } from '../product/product-visibility.util';
import { FavoriteLockService } from './favorite-lock.service';
import { ProductChildMutationLockService } from '../product/product-child-mutation-lock.service';

@Injectable()
export class FavoriteService {
  constructor(
    @InjectRepository(ProductFavoriteEntity)
    private productFavoriteRepository: Repository<ProductFavoriteEntity>,

    @InjectRepository(ProductEntity)
    private productRepository: Repository<ProductEntity>,

    private error: ErrorService,
    private favoriteLockService: FavoriteLockService,
    private productChildMutationLockService: ProductChildMutationLockService,
  ) {}

  /**
   * -------------------------------------------------------
   * PUT /favorites/product/:productId/me
   *
   * Lock order: Product child/lifecycle lock → Favorite toggle lock.
   * Never acquire Product lock while holding only Favorite lock from other paths.
   */
  async addDeleteProduct(productId: number, customer: CustomerEntity) {
    return this.productChildMutationLockService.withProductChildLock(
      productId,
      async () =>
        this.favoriteLockService.withFavoriteToggleLock(
          customer.id,
          productId,
          async () => {
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

            const product = await this.productRepository.findOne({
              where: { id: productId },
              select: ['id', 'isDeleted', 'status', 'categoryId'],
            });

            if (!product || !isCustomerVisibleProduct(product)) {
              this.error.unprocessableEntity(['محصول مورد نظر یافت نشد!']);
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
          },
        ),
    );
  }

  /**
   * -------------------------------------------------------
   * GET /favorites/products/me
   */
  async getProducts(customer: CustomerEntity) {
    const list = await this.productFavoriteRepository
      .createQueryBuilder('favorite')
      .innerJoin(
        ProductEntity,
        'product',
        'product.id = favorite.productId AND product.isDeleted = 0 AND product.status = :activeStatus AND product.categoryId != 1',
        { activeStatus: 'active' },
      )
      .select(['favorite.id', 'favorite.productId'])
      .where({ customerId: customer.id, isDeleted: false })
      .getRawMany();

    return list.map((item) => item.productId);
  }
}
