import {
  MarketplaceImportConcurrencyGate,
  MarketplaceImportQueueFullError,
  MarketplaceImportQueueTimeoutError,
} from './marketplace-import-concurrency';
import { MarketplaceConfigError } from './marketplace-config.util';

describe('MarketplaceImportConcurrencyGate', () => {
  it('enforces max concurrency', async () => {
    const gate = new MarketplaceImportConcurrencyGate({
      maxConcurrent: 1,
      maxQueue: 2,
      queueTimeoutMs: 5000,
    });

    const first = await gate.acquire();
    let secondAcquired = false;
    const second = gate.acquire().then((permit) => {
      secondAcquired = true;
      return permit;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondAcquired).toBe(false);

    first.release();
    const secondPermit = await second;
    expect(secondAcquired).toBe(true);
    secondPermit.release();
  });

  it('rejects zero config', () => {
    expect(
      () =>
        new MarketplaceImportConcurrencyGate({
          maxConcurrent: 0,
          maxQueue: 1,
          queueTimeoutMs: 1000,
        }),
    ).toThrow(MarketplaceConfigError);
  });

  it('rejects negative config', () => {
    expect(
      () =>
        new MarketplaceImportConcurrencyGate({
          maxConcurrent: -1,
          maxQueue: 1,
          queueTimeoutMs: 1000,
        }),
    ).toThrow(MarketplaceConfigError);
  });

  it('rejects NaN config', () => {
    expect(
      () =>
        new MarketplaceImportConcurrencyGate({
          maxConcurrent: Number.NaN,
          maxQueue: 1,
          queueTimeoutMs: 1000,
        }),
    ).toThrow(MarketplaceConfigError);
  });

  it('enforces queue cap', async () => {
    const gate = new MarketplaceImportConcurrencyGate({
      maxConcurrent: 1,
      maxQueue: 1,
      queueTimeoutMs: 5000,
    });

    const first = await gate.acquire();
    const queued = gate.acquire();
    await expect(gate.acquire()).rejects.toBeInstanceOf(
      MarketplaceImportQueueFullError,
    );

    first.release();
    const permit = await queued;
    permit.release();
  });

  it('times out queued waiters safely', async () => {
    jest.useFakeTimers();
    const gate = new MarketplaceImportConcurrencyGate({
      maxConcurrent: 1,
      maxQueue: 2,
      queueTimeoutMs: 1000,
    });

    const first = await gate.acquire();
    const waiter = gate.acquire();

    jest.advanceTimersByTime(1001);

    await expect(waiter).rejects.toBeInstanceOf(
      MarketplaceImportQueueTimeoutError,
    );

    first.release();
    const next = await gate.acquire();
    next.release();
    jest.useRealTimers();
  });

  it('does not double-release permits', async () => {
    const gate = new MarketplaceImportConcurrencyGate({
      maxConcurrent: 1,
      maxQueue: 1,
      queueTimeoutMs: 1000,
    });

    const permit = await gate.acquire();
    permit.release();
    permit.release();
    expect(gate.getActiveCount()).toBe(0);
  });
});
