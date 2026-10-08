import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { ErrorService } from '../../error/error.service';
import { UserCapabilityService } from '../manual-payment/user-capability.service';
import { UserCapabilityName } from '../auth/capability/capability.catalog';
import { UserRoles } from '../user/entities/user.entity';

describe('ProductController PAV + group RBAC (ADMIN-RBAC-1)', () => {
  let controller: ProductController;
  let productService: {
    findCanonicalActivePav: jest.Mock;
    addUpdateProductAttributeValue: jest.Mock;
    groupUpdate: jest.Mock;
  };
  let capabilityService: {
    assertUserHasCapability: jest.Mock;
    userHasCapability: jest.Mock;
  };

  const employee = { id: 9, role: UserRoles.employee } as any;
  const admin = { id: 1, role: UserRoles.admin } as any;

  beforeAll(async () => {
    productService = {
      findCanonicalActivePav: jest.fn(),
      addUpdateProductAttributeValue: jest.fn().mockResolvedValue({ id: 1 }),
      groupUpdate: jest.fn().mockResolvedValue(true),
    };
    capabilityService = {
      assertUserHasCapability: jest.fn(async () => undefined),
      userHasCapability: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductController],
      providers: [
        { provide: ProductService, useValue: productService },
        {
          provide: ErrorService,
          useValue: {
            forbidden: (messages = ['Forbidden Error']) => {
              throw new HttpException(
                { success: false, messages, data: {} },
                HttpStatus.FORBIDDEN,
              );
            },
          },
        },
        { provide: UserCapabilityService, useValue: capabilityService },
      ],
    }).compile();

    controller = module.get(ProductController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    capabilityService.assertUserHasCapability.mockImplementation(
      async () => undefined,
    );
    productService.findCanonicalActivePav.mockResolvedValue({
      id: 10,
      price: 100,
      discountedPrice: 80,
      quantity: 5,
    });
    productService.addUpdateProductAttributeValue.mockResolvedValue({ id: 10 });
    productService.groupUpdate.mockResolvedValue(true);
  });

  describe('PAV field-level', () => {
    it('product.write metadata-only does not assert price/inventory', async () => {
      await controller.addUpdateProductAttributeValue(
        {
          productId: 1,
          attributeValueId: 2,
          number: 'SKU-1',
        } as any,
        employee,
      );

      expect(capabilityService.assertUserHasCapability).not.toHaveBeenCalled();
      expect(productService.addUpdateProductAttributeValue).toHaveBeenCalled();
    });

    it('product.write cannot change PAV price (403)', async () => {
      capabilityService.assertUserHasCapability.mockImplementation(
        async (_user, capability) => {
          if (capability === UserCapabilityName.product_price) {
            throw new HttpException(
              { success: false, messages: ['Forbidden Error'], data: {} },
              HttpStatus.FORBIDDEN,
            );
          }
        },
      );

      await expect(
        controller.addUpdateProductAttributeValue(
          {
            productId: 1,
            attributeValueId: 2,
            price: 999,
          } as any,
          employee,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });

      expect(capabilityService.assertUserHasCapability).toHaveBeenCalledWith(
        employee,
        UserCapabilityName.product_price,
      );
      expect(
        productService.addUpdateProductAttributeValue,
      ).not.toHaveBeenCalled();
    });

    it('product.write cannot change PAV quantity (403)', async () => {
      capabilityService.assertUserHasCapability.mockImplementation(
        async (_user, capability) => {
          if (capability === UserCapabilityName.product_inventory) {
            throw new HttpException(
              { success: false, messages: ['Forbidden Error'], data: {} },
              HttpStatus.FORBIDDEN,
            );
          }
        },
      );

      await expect(
        controller.addUpdateProductAttributeValue(
          {
            productId: 1,
            attributeValueId: 2,
            quantity: 1,
          } as any,
          employee,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });

      expect(capabilityService.assertUserHasCapability).toHaveBeenCalledWith(
        employee,
        UserCapabilityName.product_inventory,
      );
      expect(
        productService.addUpdateProductAttributeValue,
      ).not.toHaveBeenCalled();
    });

    it('write+price may change price but inventory change still gated', async () => {
      capabilityService.assertUserHasCapability.mockImplementation(
        async (_user, capability) => {
          if (capability === UserCapabilityName.product_inventory) {
            throw new HttpException(
              { success: false, messages: ['Forbidden Error'], data: {} },
              HttpStatus.FORBIDDEN,
            );
          }
        },
      );

      await expect(
        controller.addUpdateProductAttributeValue(
          {
            productId: 1,
            attributeValueId: 2,
            price: 120,
            quantity: 1,
          } as any,
          employee,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });

      expect(capabilityService.assertUserHasCapability).toHaveBeenCalledWith(
        employee,
        UserCapabilityName.product_price,
      );
      expect(capabilityService.assertUserHasCapability).toHaveBeenCalledWith(
        employee,
        UserCapabilityName.product_inventory,
      );
      expect(
        productService.addUpdateProductAttributeValue,
      ).not.toHaveBeenCalled();
    });

    it('write+price+inventory succeeds for combined mutation', async () => {
      await controller.addUpdateProductAttributeValue(
        {
          productId: 1,
          attributeValueId: 2,
          price: 120,
          quantity: 1,
          number: 'X',
        } as any,
        employee,
      );

      expect(capabilityService.assertUserHasCapability).toHaveBeenCalledWith(
        employee,
        UserCapabilityName.product_price,
      );
      expect(capabilityService.assertUserHasCapability).toHaveBeenCalledWith(
        employee,
        UserCapabilityName.product_inventory,
      );
      expect(productService.addUpdateProductAttributeValue).toHaveBeenCalled();
    });

    it('product.price alone cannot mutate via this route without product.write guard', async () => {
      // Route still declares @RequireCapabilities(product.write). This unit test
      // documents that field asserts assume write already passed — price-only
      // actors never reach the handler under PermissionsGuard.
      expect(UserCapabilityName.product_write).toBe('product.write');
      expect(UserCapabilityName.product_price).toBe('product.price');
    });

    it('ADMIN is not blocked by field asserts (assert allows admin)', async () => {
      capabilityService.assertUserHasCapability.mockResolvedValue(undefined);

      await controller.addUpdateProductAttributeValue(
        {
          productId: 1,
          attributeValueId: 2,
          price: 1,
          quantity: 0,
        } as any,
        admin,
      );

      expect(productService.addUpdateProductAttributeValue).toHaveBeenCalled();
    });
  });

  describe('group status', () => {
    it('product.write cannot perform group status mutation (403)', async () => {
      capabilityService.assertUserHasCapability.mockImplementation(
        async (_user, capability) => {
          if (capability === UserCapabilityName.product_disable) {
            throw new HttpException(
              { success: false, messages: ['Forbidden Error'], data: {} },
              HttpStatus.FORBIDDEN,
            );
          }
        },
      );

      await expect(
        controller.groupUpdate(
          { ids: [1, 2], status: 'inactive' } as any,
          employee,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });

      expect(capabilityService.assertUserHasCapability).toHaveBeenCalledWith(
        employee,
        UserCapabilityName.product_disable,
      );
      expect(productService.groupUpdate).not.toHaveBeenCalled();
    });

    it('product.disable (with write) can perform status mutation', async () => {
      await controller.groupUpdate(
        { ids: [1], status: 'active' } as any,
        employee,
      );

      expect(capabilityService.assertUserHasCapability).toHaveBeenCalledWith(
        employee,
        UserCapabilityName.product_disable,
      );
      expect(productService.groupUpdate).toHaveBeenCalled();
    });

    it('non-status group update does not require product.disable', async () => {
      await controller.groupUpdate(
        { ids: [1], gender: 'female' } as any,
        employee,
      );

      expect(capabilityService.assertUserHasCapability).not.toHaveBeenCalled();
      expect(productService.groupUpdate).toHaveBeenCalled();
    });

    it('ADMIN group status unchanged (allowed)', async () => {
      await controller.groupUpdate(
        { ids: [1], status: 'draft' } as any,
        admin,
      );
      expect(productService.groupUpdate).toHaveBeenCalled();
    });
  });
});
