import axios from 'axios';
import { DiscountEngineService } from './discount-engine.service';
import { DiscountPoolEntryStatus } from './entities/discount-discovery-pool.entity';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DiscountEngineService', () => {
  beforeEach(() => {
    mockedAxios.post.mockResolvedValue({
      data: { listingRequests: 0, items: [], flashTags: [], probes: [] },
    } as any);
    mockedAxios.get.mockResolvedValue({ data: { ok: true } } as any);
  });

  function buildService(activePool: any[] = []) {
    const saved: any[] = [];
    const productQueries: any[] = [];
    const productUpdates: any[] = [];
    const poolRepo = {
      find: jest.fn(async ({ where }: any) => {
        if (where?.status === DiscountPoolEntryStatus.active) {
          return activePool.filter((r) => r.status === 'active');
        }
        return activePool;
      }),
      save: jest.fn(async (row: any) => {
        saved.push(row);
        return row;
      }),
      findOne: jest.fn(async () => null),
      create: jest.fn((row: any) => row),
    };
    const productRepo = {
      query: jest.fn(async (...args: any[]) => {
        productQueries.push(args);
        return [];
      }),
      update: jest.fn(async (...args: any[]) => {
        productUpdates.push(args);
        return { affected: 1 };
      }),
      findOne: jest.fn(async () => null),
    };
    const svc = new DiscountEngineService(
      { crawler: { baseUrl: 'http://127.0.0.1:9020', internalSecret: 'x' } } as any,
      { createOrReuseCatalogRefreshJob: jest.fn() } as any,
      productRepo as any,
      { findOne: jest.fn() } as any,
      poolRepo as any,
    );
    return { svc, saved, productQueries, productUpdates, poolRepo, productRepo };
  }

  it('dry-run plans expirations without writing', async () => {
    const expiredAt = new Date(Date.now() - 60_000);
    const { svc, saved, productQueries, productUpdates } = buildService([
      {
        id: 1,
        productId: 99,
        status: 'active',
        displayExpiresAt: expiredAt,
        verifiedDiscountPct: 40,
        categoryName: 'Elbise',
      },
    ]);

    const report: any = await svc.execute({ mode: 'dry_run' });
    expect(report.mode).toBe('dry_run');
    expect(report.expireReport.applied).toBe(false);
    expect(report.expireReport.expired).toBe(0);
    expect(report.expireReport.plannedExpirations).toEqual([
      { poolId: 1, productId: 99 },
    ]);
    expect(report.confirmation.dryRunPerformsNoWrites).toBe(true);
    expect(saved).toHaveLength(0);
    expect(productQueries).toHaveLength(0);
    expect(productUpdates).toHaveLength(0);
    expect(report.verification.attempted).toBe(0);
  });

  it('live expiry marks pool expired but does not clear discountDisplayExpiresAt', async () => {
    process.env.DISCOUNT_ENGINE_LIVE_ENABLED = 'true';
    const expiredAt = new Date(Date.now() - 60_000);
    const row = {
      id: 2,
      productId: 100,
      status: 'active',
      displayExpiresAt: expiredAt,
      verifiedDiscountPct: 35,
      categoryName: 'Elbise',
    };
    const { svc, saved, productQueries, productUpdates } = buildService([row]);
    const report: any = await svc.execute({ mode: 'live' });
    expect(report.expireReport.applied).toBe(true);
    expect(report.expireReport.expired).toBe(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe(DiscountPoolEntryStatus.expired);
    // Must not NULL the authoritative deadline.
    expect(productQueries).toHaveLength(0);
    expect(
      productUpdates.every(
        (args) =>
          !(
            args[1] &&
            Object.prototype.hasOwnProperty.call(
              args[1],
              'discountDisplayExpiresAt',
            ) &&
            args[1].discountDisplayExpiresAt == null
          ),
      ),
    ).toBe(true);
    delete process.env.DISCOUNT_ENGINE_LIVE_ENABLED;
  });

  it('listHomepageEligibleProductIds excludes expired display windows', async () => {
    const { svc } = buildService([
      {
        id: 1,
        productId: 10,
        status: 'active',
        displayExpiresAt: new Date(Date.now() + 60_000),
        verifiedDiscountPct: 40,
      },
      {
        id: 2,
        productId: 11,
        status: 'active',
        displayExpiresAt: new Date(Date.now() - 1),
        verifiedDiscountPct: 50,
      },
    ]);
    const ids = await svc.listHomepageEligibleProductIds(new Date());
    expect(ids).toEqual([10]);
  });
});
