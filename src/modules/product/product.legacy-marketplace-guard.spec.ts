import { ProductService } from './product.service';

describe('ProductService legacy marketplace creation guard', () => {
  it('fails closed instead of inserting marketplace stubs', async () => {
    const error = {
      methodNotAllowed: jest.fn((messages: string[]) => {
        throw new Error(messages[0]);
      }),
    };
    const service = {
      error,
      getProductsPagesByCrawler:
        ProductService.prototype.getProductsPagesByCrawler,
    } as any;

    await expect(service.getProductsPagesByCrawler()).rejects.toThrow(
      'این مسیر دیگر پشتیبانی نمی‌شود',
    );
    expect(error.methodNotAllowed).toHaveBeenCalled();
  });
});
