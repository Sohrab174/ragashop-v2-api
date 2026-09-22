import { MarketplaceImportCoalescer } from './marketplace-import-coalescer';

describe('MarketplaceImportCoalescer', () => {
  it('coalesces concurrent imports for same key', async () => {
    const coalescer = new MarketplaceImportCoalescer();
    let calls = 0;

    const factory = () =>
      new Promise<{ id: number; name: string }>((resolve) => {
        calls += 1;
        setTimeout(() => resolve({ id: 1, name: 'test' }), 50);
      });

    const [a, b] = await Promise.all([
      coalescer.coalesce('key', factory),
      coalescer.coalesce('key', factory),
    ]);

    expect(calls).toBe(1);
    expect(a).toEqual({ id: 1, name: 'test' });
    expect(b).toEqual({ id: 1, name: 'test' });
  });
});
