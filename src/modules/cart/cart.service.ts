import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ErrorService } from '../../error/error.service';
import { SettingService } from '../setting/setting.service';
import { ProductEntity } from '../product/entities/product.entity';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { CartEntity } from './entities/cart.entity';
import { CartItemEntity } from './entities/cart-item.entity';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';
import { resolveCartLineConfig } from './cart-line.resolve';
import {
  mapStorefrontCartResponse,
  type CartReadProductRow,
  type StorefrontCartResponse,
} from './cart-read.mapper';
import {
  CART_MAX_LINE_QUANTITY,
  clampCartQuantityAgainstStock,
  isValidCartSessionKey,
} from './cart-stock';
import {
  parseStrictPositiveInt,
  validateOrderItemQuantity,
} from '../order/utils/commerce-input.validator';
import { isMysqlDuplicateKeyError } from '../order/utils/duplicate-key.util';
import {
  isCartOwnershipUniqueViolation,
  withCartOwnershipConflictRetry,
} from './cart-ownership-conflict.util';
import type { ResolvedCartLineConfig } from './cart-line.resolve';

export const CART_SESSION_HEADER = 'x-cart-session';

export type CartOwnerContext = {
  customerId: number | null;
  sessionKey: string | null;
};

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartEntity)
    private cartRepository: Repository<CartEntity>,
    @InjectRepository(CartItemEntity)
    private cartItemRepository: Repository<CartItemEntity>,
    @InjectRepository(ProductEntity)
    private productRepository: Repository<ProductEntity>,
    private settingService: SettingService,
    private error: ErrorService,
  ) {}

  resolveOwner(
    customer: CustomerEntity | null | undefined,
    sessionHeader: string | null | undefined,
  ): CartOwnerContext {
    const customerId = customer?.id ?? null;
    let sessionKey: string | null = null;
    if (sessionHeader && isValidCartSessionKey(sessionHeader)) {
      sessionKey = sessionHeader.trim();
    } else if (sessionHeader && String(sessionHeader).trim()) {
      this.error.unprocessableEntity(['شناسه سبد خرید نامعتبر است']);
    }
    return { customerId, sessionKey };
  }

  ensureSessionKey(owner: CartOwnerContext): string {
    if (owner.customerId) {
      // Authenticated carts may still carry a session for header continuity
      return owner.sessionKey || uuidv4();
    }
    return owner.sessionKey || uuidv4();
  }

  async getCart(owner: CartOwnerContext): Promise<StorefrontCartResponse> {
    const sessionKey = this.ensureSessionKey(owner);
    const cart = await this.findCart(owner, sessionKey, false);
    if (!cart) {
      return {
        sessionKey: owner.customerId ? owner.sessionKey : sessionKey,
        itemCount: 0,
        subtotal: 0,
        items: [],
      };
    }
    return this.buildCartResponse(cart);
  }

  async addItem(
    owner: CartOwnerContext,
    dto: AddCartItemDto,
  ): Promise<StorefrontCartResponse> {
    const sessionKey = this.ensureSessionKey(owner);
    const productId = parseStrictPositiveInt(
      dto.productId,
      this.error,
      'محصول ناموجود است',
    );
    const quantity = validateOrderItemQuantity(dto.quantity, this.error);
    if (quantity > CART_MAX_LINE_QUANTITY) {
      this.error.unprocessableEntity(['تعداد انتخابی نامعتبر است']);
    }

    const tryToToman = await this.settingService.getTryToToman();
    const product = await this.loadProductSnapshot(productId);
    const resolved = resolveCartLineConfig({
      product,
      quantity,
      selections: dto.selections,
      tryToToman,
    });

    if (resolved.ok === false) {
      this.error.unprocessableEntity([resolved.failure.message]);
    }
    const config = resolved.config;

    // CART1-I1: first-Cart ownership unique race → retry once in a fresh txn.
    await withCartOwnershipConflictRetry(() =>
      this.persistAddItemTransaction(owner, sessionKey, config),
    );

    const cart = await this.findCart(owner, sessionKey, false);
    if (!cart) {
      this.error.unprocessableEntity(['خطا در افزودن به سبد خرید']);
    }
    const response = await this.buildCartResponse(cart);
    // Ensure client receives session for guest carts
    if (!owner.customerId) {
      response.sessionKey = sessionKey;
    }
    return response;
  }

  /**
   * Single-attempt transactional persist. Cart ownership insert unique
   * conflicts must bubble (abort this txn) so the caller can retry fresh.
   */
  private async persistAddItemTransaction(
    owner: CartOwnerContext,
    sessionKey: string,
    config: ResolvedCartLineConfig,
  ): Promise<void> {
    await this.cartRepository.manager.transaction(async (manager) => {
      const cartRepo = manager.getRepository(CartEntity);
      const itemRepo = manager.getRepository(CartItemEntity);

      let cart = await this.findCartWithManager(
        cartRepo,
        owner,
        sessionKey,
        true,
      );

      const now = new Date();
      if (!cart) {
        const insert = await cartRepo
          .createQueryBuilder()
          .insert()
          .values({
            sessionKey: owner.customerId ? null : sessionKey,
            customerId: owner.customerId,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
        cart = await cartRepo.findOne({
          where: { id: insert.identifiers[0].id },
        });
      }

      if (!cart) {
        this.error.unprocessableEntity(['خطا در افزودن به سبد خرید']);
      }

      const existing = await itemRepo
        .createQueryBuilder('item')
        .setLock('pessimistic_write')
        .where('item.cartId = :cartId AND item.configKey = :configKey', {
          cartId: cart.id,
          configKey: config.configKey,
        })
        .getOne();

      const stockCeiling =
        config.maxQuantity == null
          ? { maxQuantity: null as number | null, available: true }
          : { maxQuantity: config.maxQuantity, available: true };

      if (existing) {
        const nextQty = existing.quantity + config.quantity;
        const clamped = clampCartQuantityAgainstStock(nextQty, stockCeiling);
        if (clamped.ok === false) {
          this.error.unprocessableEntity([
            clamped.reason === 'exceeds_stock'
              ? 'تعداد انتخابی بیشتر از موجودی است'
              : 'محصول ناموجود است',
          ]);
        }
        await itemRepo
          .createQueryBuilder()
          .update()
          .set({ quantity: clamped.quantity, updatedAt: now })
          .where({ id: existing.id, cartId: cart.id })
          .execute();
      } else {
        try {
          await itemRepo
            .createQueryBuilder()
            .insert()
            .values({
              cartId: cart.id,
              productId: config.productId,
              productAttributeValueId: config.productAttributeValueId,
              configKey: config.configKey,
              quantity: config.quantity,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
        } catch (err: any) {
          // Same-config item race only (not Cart ownership).
          if (
            (isMysqlDuplicateKeyError(err) ||
              isMysqlDuplicateKeyError(err?.driverError)) &&
            !isCartOwnershipUniqueViolation(err)
          ) {
            const raced = await itemRepo
              .createQueryBuilder('item')
              .setLock('pessimistic_write')
              .where('item.cartId = :cartId AND item.configKey = :configKey', {
                cartId: cart.id,
                configKey: config.configKey,
              })
              .getOne();
            if (!raced) {
              this.error.unprocessableEntity(['خطا در افزودن به سبد خرید']);
            }
            const nextQty = raced.quantity + config.quantity;
            const clamped = clampCartQuantityAgainstStock(
              nextQty,
              stockCeiling,
            );
            if (clamped.ok === false) {
              this.error.unprocessableEntity([
                clamped.reason === 'exceeds_stock'
                  ? 'تعداد انتخابی بیشتر از موجودی است'
                  : 'محصول ناموجود است',
              ]);
            }
            await itemRepo
              .createQueryBuilder()
              .update()
              .set({ quantity: clamped.quantity, updatedAt: now })
              .where({ id: raced.id, cartId: cart.id })
              .execute();
          } else {
            throw err;
          }
        }
      }

      await cartRepo
        .createQueryBuilder()
        .update()
        .set({ updatedAt: now })
        .where({ id: cart.id })
        .execute();
    });
  }

  async updateItem(
    owner: CartOwnerContext,
    itemIdRaw: unknown,
    dto: UpdateCartItemDto,
  ): Promise<StorefrontCartResponse> {
    const sessionKey = this.ensureSessionKey(owner);
    const itemId = parseStrictPositiveInt(
      itemIdRaw,
      this.error,
      'آیتم سبد خرید یافت نشد',
    );
    const quantity = validateOrderItemQuantity(dto.quantity, this.error);
    if (quantity > CART_MAX_LINE_QUANTITY) {
      this.error.unprocessableEntity(['تعداد انتخابی نامعتبر است']);
    }

    const cart = await this.findCart(owner, sessionKey, false);
    if (!cart) {
      this.error.unprocessableEntity(['آیتم سبد خرید یافت نشد']);
    }

    const item = await this.cartItemRepository.findOne({
      where: { id: itemId, cartId: cart.id },
    });
    if (!item) {
      this.error.unprocessableEntity(['آیتم سبد خرید یافت نشد']);
    }

    const tryToToman = await this.settingService.getTryToToman();
    const product = await this.loadProductSnapshot(item.productId);
    const selections =
      item.productAttributeValueId != null
        ? await this.selectionsFromPav(product, item.productAttributeValueId)
        : [];

    const resolved = resolveCartLineConfig({
      product,
      quantity,
      selections,
      tryToToman,
    });
    if (resolved.ok === false) {
      this.error.unprocessableEntity([resolved.failure.message]);
    }

    const now = new Date();
    await this.cartItemRepository
      .createQueryBuilder()
      .update()
      .set({ quantity: resolved.config.quantity, updatedAt: now })
      .where({ id: item.id, cartId: cart.id })
      .execute();

    await this.cartRepository
      .createQueryBuilder()
      .update()
      .set({ updatedAt: now })
      .where({ id: cart.id })
      .execute();

    return this.buildCartResponse(cart);
  }

  async removeItem(
    owner: CartOwnerContext,
    itemIdRaw: unknown,
  ): Promise<StorefrontCartResponse> {
    const sessionKey = this.ensureSessionKey(owner);
    const itemId = parseStrictPositiveInt(
      itemIdRaw,
      this.error,
      'آیتم سبد خرید یافت نشد',
    );

    const cart = await this.findCart(owner, sessionKey, false);
    if (!cart) {
      // Idempotent empty cart
      return {
        sessionKey: owner.customerId ? owner.sessionKey : sessionKey,
        itemCount: 0,
        subtotal: 0,
        items: [],
      };
    }

    await this.cartItemRepository
      .createQueryBuilder()
      .delete()
      .where({ id: itemId, cartId: cart.id })
      .execute();

    await this.cartRepository
      .createQueryBuilder()
      .update()
      .set({ updatedAt: new Date() })
      .where({ id: cart.id })
      .execute();

    return this.buildCartResponse(cart);
  }

  private async selectionsFromPav(
    product: CartReadProductRow | null,
    pavId: number,
  ): Promise<Array<{ attributeId: number; valueId: number }>> {
    if (!product?.productAttributeValues) return [];
    const pav = product.productAttributeValues.find((p) => p.id === pavId);
    const attributeId =
      Number(pav?.attributeValue?.attribute?.id) ||
      Number(pav?.attributeValue?.attributeId) ||
      0;
    if (!attributeId) return [{ attributeId: 1, valueId: pavId }];
    return [{ attributeId, valueId: pavId }];
  }

  private async findCart(
    owner: CartOwnerContext,
    sessionKey: string,
    _forUpdate: boolean,
  ): Promise<CartEntity | null> {
    if (owner.customerId) {
      return this.cartRepository.findOne({
        where: { customerId: owner.customerId },
      });
    }
    if (!sessionKey) return null;
    return this.cartRepository.findOne({
      where: { sessionKey },
    });
  }

  private async findCartWithManager(
    cartRepo: Repository<CartEntity>,
    owner: CartOwnerContext,
    sessionKey: string,
    forUpdate: boolean,
  ): Promise<CartEntity | null> {
    const qb = cartRepo.createQueryBuilder('cart');
    if (owner.customerId) {
      qb.where('cart.customerId = :customerId', {
        customerId: owner.customerId,
      });
    } else {
      qb.where('cart.sessionKey = :sessionKey', { sessionKey });
    }
    if (forUpdate) {
      qb.setLock('pessimistic_write');
    }
    return qb.getOne();
  }

  private async loadProductSnapshot(
    productId: number,
  ): Promise<CartReadProductRow | null> {
    const product = await this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.cover', 'cover')
      .leftJoinAndSelect(
        'product.productAttributeValues',
        'pav',
        'pav.isDeleted = 0',
      )
      .leftJoinAndSelect('pav.attributeValue', 'attributeValue')
      .leftJoinAndSelect('attributeValue.attribute', 'attribute')
      .where('product.id = :productId', { productId })
      .getOne();

    if (!product) return null;

    return {
      id: product.id,
      name: product.name,
      price: product.price,
      discountedPrice: product.discountedPrice,
      quantity: product.quantity,
      isSellable: product.isSellable,
      isDeleted: product.isDeleted,
      status: product.status,
      categoryId: product.categoryId,
      coverPath: product.cover?.pathFile || null,
      productAttributeValues: (product.productAttributeValues || []).map(
        (pav) => ({
          id: pav.id,
          quantity: pav.quantity,
          price: pav.price,
          discountedPrice: pav.discountedPrice,
          attributeValue: pav.attributeValue
            ? {
                id: pav.attributeValue.id,
                name: pav.attributeValue.name,
                extraValue: pav.attributeValue.extraValue,
                attributeId: pav.attributeValue.attributeId,
                attribute: pav.attributeValue.attribute
                  ? {
                      id: pav.attributeValue.attribute.id,
                      name: pav.attributeValue.attribute.name,
                      type: pav.attributeValue.attribute.type,
                    }
                  : null,
              }
            : null,
        }),
      ),
    };
  }

  private async buildCartResponse(
    cart: CartEntity,
  ): Promise<StorefrontCartResponse> {
    const items = await this.cartItemRepository.find({
      where: { cartId: cart.id },
      order: { id: 'ASC' },
    });

    const productIds = [...new Set(items.map((i) => i.productId))];
    const productsById = new Map<number, CartReadProductRow>();

    if (productIds.length) {
      const products = await this.productRepository
        .createQueryBuilder('product')
        .leftJoinAndSelect('product.cover', 'cover')
        .leftJoinAndSelect(
          'product.productAttributeValues',
          'pav',
          'pav.isDeleted = 0',
        )
        .leftJoinAndSelect('pav.attributeValue', 'attributeValue')
        .leftJoinAndSelect('attributeValue.attribute', 'attribute')
        .where('product.id IN (:...productIds)', { productIds })
        .getMany();

      for (const product of products) {
        productsById.set(product.id, {
          id: product.id,
          name: product.name,
          price: product.price,
          discountedPrice: product.discountedPrice,
          quantity: product.quantity,
          isSellable: product.isSellable,
          isDeleted: product.isDeleted,
          status: product.status,
          categoryId: product.categoryId,
          coverPath: product.cover?.pathFile || null,
          productAttributeValues: (product.productAttributeValues || []).map(
            (pav) => ({
              id: pav.id,
              quantity: pav.quantity,
              price: pav.price,
              discountedPrice: pav.discountedPrice,
              attributeValue: pav.attributeValue
                ? {
                    id: pav.attributeValue.id,
                    name: pav.attributeValue.name,
                    extraValue: pav.attributeValue.extraValue,
                    attributeId: pav.attributeValue.attributeId,
                    attribute: pav.attributeValue.attribute
                      ? {
                          id: pav.attributeValue.attribute.id,
                          name: pav.attributeValue.attribute.name,
                          type: pav.attributeValue.attribute.type,
                        }
                      : null,
                  }
                : null,
            }),
          ),
        });
      }
    }

    const tryToToman = await this.settingService.getTryToToman();
    return mapStorefrontCartResponse({
      sessionKey: cart.sessionKey,
      items: items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productAttributeValueId: i.productAttributeValueId,
        quantity: i.quantity,
      })),
      productsById,
      tryToToman,
    });
  }
}
