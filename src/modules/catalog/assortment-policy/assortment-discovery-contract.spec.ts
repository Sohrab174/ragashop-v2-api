/**
 * SCOPE-5/6 — discovery parity, ancestor leakage, refresh gate, internal
 * snapshot auth and the API ⇄ crawler contract fixture.
 */
import * as fs from 'fs';
import * as path from 'path';
import { UnauthorizedException } from '@nestjs/common';
import { InternalAuthGuard } from '../../../common/internal-auth.guard';
import { applyDiscoveryEligibilityFilters } from '../../product/discovery-eligibility';
import {
  EligibilityMappingRow,
  isProductCanonicallyEligible,
  resolveCanonicalProductEligibility,
} from '../canonical-product-eligibility';
import { CatalogRefreshExecutorService } from '../../catalog-lifecycle/catalog-refresh-executor.service';
import { AssortmentPolicySnapshotService } from './assortment-policy-snapshot.service';
import { CatalogController } from '../catalog.controller';
import {
  ASSORTMENT_CRAWLER_ENFORCEMENT_ENV,
  ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV,
  ASSORTMENT_OUT_CUSTOMER_MESSAGE,
  ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
  evaluateAssortmentCommerceGate,
  resolveCrawlerAssortmentGate,
} from './assortment-enforcement';

const FIXTURE_PATH = path.join(
  __dirname,
  'contract',
  'assortment-policy-snapshot.contract.json',
);
const CRAWLER_FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../../ragashop-crawler/src/assortment-policy/contract/assortment-policy-snapshot.contract.json',
);
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

function withEnv(
  name: string,
  value: string | undefined,
  fn: () => void | Promise<void>,
) {
  return async () => {
    const prev = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    }
  };
}

describe('SCOPE-5/6 discovery: PLP / Search / nav share one predicate', () => {
  const capture = () => {
    const calls: string[] = [];
    const builder: any = {
      andWhere(sql: string) {
        calls.push(sql);
        return builder;
      },
    };
    return { calls, builder };
  };

  it(
    'flag OFF → unchanged single discovery predicate (shadow default)',
    withEnv(ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV, undefined, () => {
      const { calls, builder } = capture();
      applyDiscoveryEligibilityFilters(builder, 'product');
      expect(calls).toHaveLength(1);
      expect(calls.join(' ')).not.toContain('category_assortment_resolution');
    }),
  );

  it(
    'flag ON → IN_SCOPE EXISTS predicate (missing resolution fails closed)',
    withEnv(ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV, '1', () => {
      const { calls, builder } = capture();
      applyDiscoveryEligibilityFilters(builder, 'p');
      expect(calls).toHaveLength(2);
      expect(calls[1]).toContain('EXISTS');
      expect(calls[1]).toContain('category_assortment_resolution');
      expect(calls[1]).toContain('.categoryId = p.categoryId');
      expect(calls[1]).toContain("status = 'IN_SCOPE'");
      // No per-product parameters / lookups: one correlated predicate.
      expect(calls[1]).not.toMatch(/:\w+/);
    }),
  );
});

describe('SCOPE-5/6 ancestor leakage (canonical scope expansion)', () => {
  // canonical 14 (neutral) → 56; source 200 (REVIEW) → 201 (IN), 202 (OUT), 203 (no resolution)
  const canonicalRows = [
    {
      id: 14,
      parentId: null,
      status: 'active',
      name: 'زیبایی',
      audience: null,
    },
    { id: 56, parentId: 14, status: 'active', name: 'مراقبت', audience: null },
  ];
  const sourceTaxonomy = [
    {
      id: 200,
      parentId: null,
      source: 'trendyol',
      status: 'active',
      name: 'Root',
    },
    {
      id: 201,
      parentId: 200,
      source: 'trendyol',
      status: 'active',
      name: 'In',
    },
    {
      id: 202,
      parentId: 200,
      source: 'trendyol',
      status: 'active',
      name: 'Out',
    },
    {
      id: 203,
      parentId: 200,
      source: 'trendyol',
      status: 'active',
      name: 'Unknown',
    },
  ];
  const mappings: EligibilityMappingRow[] = [
    {
      id: 1,
      sourceCategoryId: 200,
      canonicalCategoryId: 56,
      genderSlice: 'any',
      reviewStatus: 'legacy_unreviewed',
      status: 'active',
      source: 'trendyol',
    } as any,
  ];
  const statusMap = new Map<number, string>([
    [200, 'REVIEW_REQUIRED'],
    [201, 'IN_SCOPE'],
    [202, 'OUT_OF_SCOPE'],
  ]);

  it(
    'flag OFF → legacy expansion includes every descendant (unchanged)',
    withEnv(ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV, undefined, () => {
      const e = resolveCanonicalProductEligibility(56, {
        canonicalRows,
        mappings,
        sourceTaxonomy,
        assortmentStatusByCategoryId: statusMap,
      });
      expect(e.sourceCategoryIds).toEqual([200, 201, 202, 203]);
    }),
  );

  it(
    'flag ON → mapped REVIEW ancestor no longer leaks OUT/unknown descendants',
    withEnv(ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV, '1', () => {
      const e = resolveCanonicalProductEligibility(56, {
        canonicalRows,
        mappings,
        sourceTaxonomy,
        assortmentStatusByCategoryId: statusMap,
      });
      expect(e.sourceCategoryIds).toEqual([201]);
      expect(
        isProductCanonicallyEligible({ categoryId: 201, gender: null }, e),
      ).toBe(true);
      for (const cat of [200, 202, 203]) {
        expect(
          isProductCanonicallyEligible({ categoryId: cat, gender: null }, e),
        ).toBe(false);
      }
    }),
  );

  it(
    'flag ON + all descendants non-IN → empty scope (SQL becomes 1 = 0)',
    withEnv(ASSORTMENT_DISCOVERY_ENFORCEMENT_ENV, '1', () => {
      const e = resolveCanonicalProductEligibility(56, {
        canonicalRows,
        mappings,
        sourceTaxonomy,
        assortmentStatusByCategoryId: new Map([[200, 'OUT_OF_SCOPE']]),
      });
      expect(e.sourceCategoryIds).toEqual([]);
      expect(e.clauses).toEqual([]);
    }),
  );
});

describe('SCOPE-5/6 crawler refresh gate (API executor candidate window)', () => {
  const run = async () => {
    const calls: string[] = [];
    const qb: any = {};
    for (const m of ['select', 'where', 'orderBy', 'take'])
      qb[m] = jest.fn(() => qb);
    qb.andWhere = jest.fn((sql: string) => {
      calls.push(sql);
      return qb;
    });
    qb.getMany = jest.fn(async () => []);
    const fakeThis = {
      productRepository: { createQueryBuilder: () => qb },
      config: { maxCandidateWindow: 100 },
    };
    await (
      CatalogRefreshExecutorService.prototype as any
    ).loadCandidateWindow.call(fakeThis, null, 0, 10);
    return calls;
  };

  it(
    'flag OFF → no assortment predicate',
    withEnv(ASSORTMENT_CRAWLER_ENFORCEMENT_ENV, undefined, async () => {
      const calls = await run();
      expect(calls.join(' ')).not.toContain('category_assortment_resolution');
    }),
  );

  it(
    'flag ON → only IN_SCOPE categories are refresh candidates',
    withEnv(ASSORTMENT_CRAWLER_ENFORCEMENT_ENV, '1', async () => {
      const calls = await run();
      const sql = calls.find((c) =>
        c.includes('category_assortment_resolution'),
      );
      expect(sql).toBeDefined();
      expect(sql).toContain("status = 'IN_SCOPE'");
    }),
  );
});

describe('SCOPE-5/6 internal snapshot auth (crawler → API)', () => {
  const ctx = (headers: Record<string, string>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as any);
  const SECRET = 'unit-test-secret-not-real';

  it(
    'rejects missing / wrong secret and accepts the configured one',
    withEnv('CRAWLER_INTERNAL_SECRET', SECRET, () => {
      const guard = new InternalAuthGuard();
      expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
      expect(() =>
        guard.canActivate(ctx({ 'x-crawler-secret': 'nope' })),
      ).toThrow(UnauthorizedException);
      expect(guard.canActivate(ctx({ 'x-crawler-secret': SECRET }))).toBe(true);
    }),
  );

  it(
    'fails closed when the API has no secret configured',
    withEnv('CRAWLER_INTERNAL_SECRET', undefined, () => {
      const guard = new InternalAuthGuard();
      expect(() => guard.canActivate(ctx({ 'x-crawler-secret': 'x' }))).toThrow(
        UnauthorizedException,
      );
    }),
  );
});

describe('SCOPE-5/6 API ⇄ crawler contract fixture', () => {
  it('fixture is byte-identical in API and crawler (no drift)', () => {
    if (!fs.existsSync(CRAWLER_FIXTURE_PATH)) {
      // Repos checked out separately: the crawler side asserts the same table.
      return;
    }
    expect(fs.readFileSync(CRAWLER_FIXTURE_PATH, 'utf8')).toBe(
      fs.readFileSync(FIXTURE_PATH, 'utf8'),
    );
  });

  it('internal snapshot endpoint produces the contract envelope', async () => {
    const rows = fixture.resolutionRows;
    const qb: any = {};
    for (const m of ['select', 'orderBy']) qb[m] = jest.fn(() => qb);
    qb.getMany = jest.fn(async () => rows);
    const snapshotService = new AssortmentPolicySnapshotService(
      { createQueryBuilder: () => qb } as any,
      {
        findOne: jest.fn(async () => ({
          id: 1,
          policyVersion: fixture.policyVersion,
        })),
      } as any,
      {
        materializeMissingResolutions: jest.fn(async () => ({
          changed: false,
          missingBefore: 0,
        })),
      } as any,
    );
    const controller = new CatalogController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      snapshotService,
      {} as any,
      {} as any,
    );
    const body: any = await controller.assortmentInternalSnapshot(
      fixture.provider,
    );
    expect(Number.isNaN(Date.parse(body.data.generatedAt))).toBe(false);
    const expected = JSON.parse(JSON.stringify(fixture.expectedEnvelope));
    expected.data.generatedAt = body.data.generatedAt;
    expect(body).toEqual(expected);
    // Minimal payload: no Admin/audit fields leak to the crawler.
    for (const r of body.data.resolutions) {
      expect(Object.keys(r).sort()).toEqual([
        'reasonCode',
        'sourceCategoryId',
        'status',
      ]);
    }
  });

  it('gate table matches the API implementation', () => {
    const statusById = new Map<number, string>(
      fixture.resolutionRows.map((r: any) => [r.categoryId, r.status]),
    );
    for (const c of fixture.gateCases) {
      const status = statusById.get(c.categoryId);
      const gate = resolveCrawlerAssortmentGate({
        hasValidSnapshot: c.hasValidSnapshot,
        isStale: c.isStale,
        status,
      });
      expect({
        name: c.name,
        action: gate.action,
        op: gate.operationalCode,
      }).toEqual({
        name: c.name,
        action: c.action,
        op: c.operationalCode,
      });
      if (c.commerceCode) {
        const decision = evaluateAssortmentCommerceGate(status);
        expect(decision.code).toBe(c.commerceCode);
        expect(decision.purchasable).toBe(c.purchasable);
      }
    }
    expect(fixture.customerMessages.OUT).toBe(ASSORTMENT_OUT_CUSTOMER_MESSAGE);
    expect(fixture.customerMessages.REVIEW).toBe(
      ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
    );
  });
});
