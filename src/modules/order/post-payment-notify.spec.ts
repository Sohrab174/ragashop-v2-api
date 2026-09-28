import { OrderService } from './order.service';
import { notifyPostPaymentBestEffort } from './utils/post-payment-notify';

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function trackUnhandledRejections() {
  const seen: unknown[] = [];
  const listener = (reason: unknown) => seen.push(reason);
  process.on('unhandledRejection', listener);
  return {
    seen,
    stop: () => process.off('unhandledRejection', listener),
  };
}

describe('notifyPostPaymentBestEffort', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('resolves when the notifier succeeds', async () => {
    const notifier = {
      sendPostPaymentNotifications: jest.fn(async () => undefined),
    };
    await expect(
      notifyPostPaymentBestEffort(notifier, 5),
    ).resolves.toBeUndefined();
    expect(notifier.sendPostPaymentNotifications).toHaveBeenCalledWith(5);
  });

  it('swallows a rejection', async () => {
    const notifier = {
      sendPostPaymentNotifications: jest.fn(async () => {
        throw new Error('boom');
      }),
    };
    await expect(
      notifyPostPaymentBestEffort(notifier, 5),
    ).resolves.toBeUndefined();
  });

  it('swallows a synchronous throw', async () => {
    const notifier = {
      sendPostPaymentNotifications: jest.fn(() => {
        throw new Error('sync boom');
      }),
    };
    await expect(
      notifyPostPaymentBestEffort(notifier, 5),
    ).resolves.toBeUndefined();
  });

  it('tolerates a missing notifier', async () => {
    await expect(notifyPostPaymentBestEffort(null, 5)).resolves.toBeUndefined();
  });
});

describe('OrderService.sendPostPaymentNotifications', () => {
  let tracker: ReturnType<typeof trackUnhandledRejections>;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    tracker = trackUnhandledRejections();
  });
  afterEach(() => {
    tracker.stop();
    jest.restoreAllMocks();
  });

  function makeService(opts: {
    order?: any;
    award?: any;
    referrer?: any;
    send?: jest.Mock;
    findOrder?: jest.Mock;
  }) {
    const sendNotification = opts.send ?? jest.fn(async () => undefined);
    const orderRepository = {
      findOne: opts.findOrder ?? jest.fn(async () => opts.order ?? null),
    };
    const referralAwardRepository = {
      findOne: jest.fn(async () => opts.award ?? null),
    };
    const customerService = {
      getActiveById: jest.fn(async () => opts.referrer ?? null),
    };
    const service = new OrderService(
      orderRepository as any,
      {} as any,
      {} as any,
      referralAwardRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      customerService as any,
      {} as any,
      {} as any,
      { sendNotification } as any,
      {} as any,
    );
    return { service, sendNotification };
  }

  const order = {
    id: 42,
    number: 'RS-1042',
    finalAmount: 1500,
    customer: {
      firstName: 'Ali',
      lastName: 'Rezaei',
      mobile: '+989121234567',
    },
    address: 'Tehran, secret street 12',
    latitude: 35.7,
    longitude: 51.4,
  };

  it('masks mobiles and omits address, coordinates and codes', async () => {
    const { service, sendNotification } = makeService({
      order,
      award: {
        walletIRT: 1000,
        walletUSD: 0,
        walletTRY: 0,
        referrerCustomerId: 3,
      },
      referrer: {
        firstName: 'Sara',
        lastName: 'K',
        mobile: '+905321239876',
        randomHash: '12345',
      },
    });

    await service.sendPostPaymentNotifications(42);
    await flush();

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const text = sendNotification.mock.calls.map((c) => c[0]).join('\n');
    expect(text).toContain('RS-1042');
    expect(text).toContain('***4567');
    expect(text).toContain('***9876');
    expect(text).not.toContain('9121234567');
    expect(text).not.toContain('5321239876');
    expect(text).not.toMatch(/Tehran|secret street|35\.7|51\.4|12345/);
  });

  it('handles a guest order without a customer', async () => {
    const { service, sendNotification } = makeService({
      order: { ...order, customer: null },
    });
    await expect(
      service.sendPostPaymentNotifications(42),
    ).resolves.toBeUndefined();
    await flush();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('a rejecting Telegram send never rejects and leaves no unhandled rejection', async () => {
    const { service } = makeService({
      order,
      send: jest.fn(async () => {
        throw new Error('telegram down');
      }),
    });
    await expect(
      service.sendPostPaymentNotifications(42),
    ).resolves.toBeUndefined();
    await flush();
    await flush();
    expect(tracker.seen).toEqual([]);
  });

  it('a synchronously throwing Telegram send never rejects', async () => {
    const { service } = makeService({
      order,
      send: jest.fn(() => {
        throw new Error('sync telegram failure');
      }),
    });
    await expect(
      service.sendPostPaymentNotifications(42),
    ).resolves.toBeUndefined();
    await flush();
    expect(tracker.seen).toEqual([]);
  });

  it('a failing order lookup never rejects', async () => {
    const { service, sendNotification } = makeService({
      findOrder: jest.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(
      service.sendPostPaymentNotifications(42),
    ).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
