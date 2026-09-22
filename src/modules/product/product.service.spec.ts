import { ProductService } from './product.service';

describe('ProductService (Phase 1A inventory concurrency)', () => {
  let service: ProductService;
  let mockManager: any;

  beforeEach(() => {
    mockManager = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
    };

    service = new ProductService(
      { manager: mockManager } as any,
      { manager: mockManager } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { withProductChildLock: jest.fn((_id, fn) => fn()) } as any,
    );
  });

  it('decrementQuantity returns true when stock is sufficient', async () => {
    mockManager.createQueryBuilder.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    });

    const result = await service.decrementQuantity(1, 2);

    expect(result).toBe(true);
  });

  it('decrementQuantity returns false when stock is insufficient', async () => {
    mockManager.createQueryBuilder.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    });

    mockManager.findOne.mockResolvedValue({ quantity: 1 });

    const result = await service.decrementQuantity(1, 5);

    expect(result).toBe(false);
  });

  it('decrementQuantity treats unlimited stock (-1) as success', async () => {
    mockManager.createQueryBuilder.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    });

    mockManager.findOne.mockResolvedValue({ quantity: -1 });

    const result = await service.decrementQuantity(1, 100);

    expect(result).toBe(true);
  });

  it('decrementAttributeQuantity returns false when variant stock is insufficient', async () => {
    mockManager.createQueryBuilder.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    });

    mockManager.findOne.mockResolvedValue({ quantity: 0 });

    const result = await service.decrementAttributeQuantity(5, 1);

    expect(result).toBe(false);
  });
});
