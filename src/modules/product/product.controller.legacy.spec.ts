import { Test, TestingModule } from '@nestjs/testing';
import { GoneException } from '@nestjs/common';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { ErrorService } from '../../error/error.service';

describe('Legacy product crawler routes', () => {
  let controller: ProductController;
  const productService = {
    getProductsDetailsByCrawler: jest.fn(),
    getProductSourceIdByCrawler: jest.fn(),
    getProductIdByCrawler: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductController],
      providers: [
        { provide: ProductService, useValue: productService },
        { provide: ErrorService, useValue: {} },
      ],
    }).compile();

    controller = module.get(ProductController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables POST /products/crawler/details/admin', () => {
    expect(() => controller.legacyCrawlerDetailsDisabled()).toThrow(
      GoneException,
    );
    expect(productService.getProductsDetailsByCrawler).not.toHaveBeenCalled();
  });

  it('disables GET /products/:id/crawler/admin', () => {
    expect(() => controller.legacyCrawlerByIdAdminDisabled()).toThrow(
      GoneException,
    );
    expect(productService.getProductSourceIdByCrawler).not.toHaveBeenCalled();
  });

  it('disables GET /products/:id/crawler', () => {
    expect(() => controller.legacyGetProductIdByCrawlerDisabled()).toThrow(
      GoneException,
    );
    expect(productService.getProductIdByCrawler).not.toHaveBeenCalled();
  });
});
