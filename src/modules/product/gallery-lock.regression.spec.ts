import { ProductService } from './product.service';
import { ProductChildMutationLockService } from './product-child-mutation-lock.service';
import { ProductGalleryType } from './entities/product-gallery.entity';

jest.mock('../../utils/sharp', () => ({
  generateThumbnail: jest.fn().mockResolvedValue(undefined),
  optimizeImage: jest.fn().mockResolvedValue(undefined),
  applyPathToThumbPath: (p: string) => p,
}));

describe('Gallery lock recursion regression', () => {
  it('addGallery does not reacquire Product child lock when replacing cover', async () => {
    let lockDepth = 0;
    const lockService = {
      withProductChildLock: jest.fn(async (_productId, fn) => {
        lockDepth += 1;
        expect(lockDepth).toBe(1);
        try {
          return await fn();
        } finally {
          lockDepth -= 1;
        }
      }),
    } as unknown as ProductChildMutationLockService;

    const service = new ProductService(
      {
        createQueryBuilder: jest.fn(() => ({
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue(undefined),
          getOne: jest.fn().mockResolvedValue({
            id: 7,
            coverId: 99,
            productGalleries: [{ id: 88, pathFile: '/products/old.jpg' }],
          }),
        })),
      } as any,
      {} as any,
      {} as any,
      {
        createQueryBuilder: jest.fn(() => ({
          insert: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 101 }] }),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          delete: jest.fn().mockReturnThis(),
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: 99,
            productId: 7,
            pathFile: '/products/cover.jpg',
            type: ProductGalleryType.photo,
            product: { coverId: 99 },
          }),
        })),
      } as any,
      {} as any,
      { unprocessableEntity: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      lockService,
    );

    const result = await service.addGallery(
      { productId: 7, isCover: true } as any,
      { filename: 'new.jpg', path: '/tmp/new.jpg' } as any,
      ProductGalleryType.photo,
      {} as any,
    );

    expect(result.id).toBe(101);
    expect(lockService.withProductChildLock).toHaveBeenCalledTimes(1);
    expect(lockDepth).toBe(0);
  });
});
