/**
 * SCOPE-5/6 — server-side commerce gates (Cart / Buy Now / Checkout / paste-link mapping).
 * Buy Now in storefront = addItem → /checkout, so the addItem gate covers it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { HttpException } from '@nestjs/common';
import { CartService } from '../../cart/cart.service';
import { ErrorService } from '../../../error/error.service';
import { resolveCheckoutLines } from '../../checkout/checkout-line.resolve';
import { AssortmentCommerceService } from './assortment-commerce.service';
import {
  applyAssortmentDecisionToAvailability,
  ASSORTMENT_COMMERCE_ENFORCEMENT_ENV,
  ASSORTMENT_OUT_CUSTOMER_MESSAGE,
  ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
  evaluateAssortmentCommerceGate,
} from './assortment-enforcement';
import { toCustomerSafeImportError } from '../../marketplace-import/marketplace-import-customer-errors';

const STATUS_BY_CAT: Record<number, string> = {
  10: 'IN_SCOPE',
  20: 'REVIEW_REQUIRED',
  30: 'OUT_OF_SCOPE',
  // 40 → missing resolution (unresolved)
};

function resolutionRepo() {
  return {
    findOne: jest.fn(async ({ where }: any) => {
      const s = STATUS_BY_CAT[Number(where.categoryId)];
      return s ? { status: s } : undefined;
    }),
    find: jest.fn(async ({ where }: any) => {
      const ids: number[] =
        where.categoryId?.value ?? where.categoryId?._value ?? [];
      return ids
        .filter((id) => STATUS_BY_CAT[id])
        .map((id) => ({ categoryId: id, status: STATUS_BY_CAT[id] }));
    }),
    manager: { query: jest.fn() },
  };
}

function product(id: number, categoryId: number) {
  return {
    id,
    name: `p${id}`,
    price: 100,
    discountedPrice: null,
    quantity: 5,
    isSellable: true,
    isDeleted: false,
    status: 'active',
    categoryId,
    cover: null,
    productAttributeValues: [],
  };
}

function qbReturning(rows: any[]) {
  const qb: any = {};
  for (const m of ['leftJoinAndSelect', 'where', 'andWhere', 'setLock']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getOne = jest.fn(async () => rows[0] ?? null);
  qb.getMany = jest.fn(async () => rows);
  return qb;
}

function makeCart(products: any[], cartItems: any[] = []) {
  const commerce = new AssortmentCommerceService(resolutionRepo() as any);
  const productRepository = {
    createQueryBuilder: jest.fn(() => qbReturning(products)),
  };
  const cartRepository = {
    findOne: jest.fn(async () => ({ id: 1, sessionKey: 's' })),
  };
  const cartItemRepository = { find: jest.fn(async () => cartItems) };
  const settingService = { getTryToToman: jest.fn(async () => 1000) };
  const service = new CartService(
    cartRepository as any,
    cartItemRepository as any,
    productRepository as any,
    settingService as any,
    new ErrorService(),
    commerce,
  );
  return { service, commerce };
}

const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e';

function withCommerceFlag(value: string | undefined, fn: () => Promise<void>) {
  return async () => {
    const prev = process.env[ASSORTMENT_COMMERCE_ENFORCEMENT_ENV];
    if (value === undefined)
      delete process.env[ASSORTMENT_COMMERCE_ENFORCEMENT_ENV];
    else process.env[ASSORTMENT_COMMERCE_ENFORCEMENT_ENV] = value;
    try {
      await fn();
    } finally {
      if (prev === undefined)
        delete process.env[ASSORTMENT_COMMERCE_ENFORCEMENT_ENV];
      else process.env[ASSORTMENT_COMMERCE_ENFORCEMENT_ENV] = prev;
    }
  };
}

async function addItemError(categoryId: number) {
  const { service } = makeCart([product(1, categoryId)]);
  try {
    await service.addItem({ customerId: null, sessionKey: SESSION }, {
      productId: 1,
      quantity: 1,
    } as any);
    return null;
  } catch (e) {
    return e as HttpException;
  }
}

describe('SCOPE-5/6 Cart / Buy Now gate (addItem)', () => {
  it(
    'OUT → 422 PRODUCT blocked with OUT wording + ASSORTMENT_OUT_OF_SCOPE code',
    withCommerceFlag('1', async () => {
      const err = await addItemError(30);
      expect(err).toBeInstanceOf(HttpException);
      expect(err!.getStatus()).toBe(422);
      const body: any = err!.getResponse();
      expect(JSON.stringify(body)).toContain(ASSORTMENT_OUT_CUSTOMER_MESSAGE);
      expect(JSON.stringify(body)).toContain('ASSORTMENT_OUT_OF_SCOPE');
    }),
  );

  it(
    'REVIEW → 422 with REVIEW wording',
    withCommerceFlag('1', async () => {
      const err = await addItemError(20);
      expect(err!.getStatus()).toBe(422);
      expect(JSON.stringify(err!.getResponse())).toContain(
        ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
      );
    }),
  );

  it(
    'missing resolution (unknown) → fail closed with REVIEW wording, never silent IN',
    withCommerceFlag('1', async () => {
      const err = await addItemError(40);
      expect(err!.getStatus()).toBe(422);
      const s = JSON.stringify(err!.getResponse());
      expect(s).toContain(ASSORTMENT_REVIEW_CUSTOMER_MESSAGE);
      expect(s).toContain('ASSORTMENT_UNRESOLVED');
    }),
  );

  it(
    'flag OFF (shadow default) → assortment gate never blocks',
    withCommerceFlag(undefined, async () => {
      const { commerce } = makeCart([]);
      expect(await commerce.assertPurchasableOrDecision(30)).toBeNull();
      expect(await commerce.assertPurchasableOrDecision(40)).toBeNull();
    }),
  );

  it(
    'IN → no assortment decision',
    withCommerceFlag('1', async () => {
      const { commerce } = makeCart([]);
      expect(await commerce.assertPurchasableOrDecision(10)).toBeNull();
    }),
  );
});

describe('SCOPE-5/6 existing cart lines become ineligible (rows kept)', () => {
  it(
    'non-IN lines are unavailable with customer note and excluded from totals',
    withCommerceFlag('1', async () => {
      const items = [
        { id: 1, productId: 1, productAttributeValueId: null, quantity: 1 },
        { id: 2, productId: 2, productAttributeValueId: null, quantity: 2 },
        { id: 3, productId: 3, productAttributeValueId: null, quantity: 1 },
      ];
      const { service } = makeCart(
        [product(1, 10), product(2, 30), product(3, 20)],
        items,
      );
      const res = await (service as any).buildCartResponse({
        id: 1,
        sessionKey: 's',
      });
      expect(res.items).toHaveLength(3);
      const byId = new Map(res.items.map((l: any) => [l.productId, l]));
      expect((byId.get(1) as any).available).toBe(true);
      expect((byId.get(2) as any).available).toBe(false);
      expect((byId.get(2) as any).availabilityNote).toBe(
        ASSORTMENT_OUT_CUSTOMER_MESSAGE,
      );
      expect((byId.get(3) as any).availabilityNote).toBe(
        ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
      );
      expect(res.itemCount).toBe(1);
      for (const l of res.items) {
        expect(JSON.stringify(l)).not.toMatch(
          /OUT_OF_SCOPE|REVIEW_REQUIRED|policyVersion/,
        );
      }
    }),
  );
});

describe('SCOPE-5/6 Checkout server revalidation', () => {
  const productsById = new Map<number, any>([
    [1, { ...product(1, 10), coverPath: null }],
    [2, { ...product(2, 30), coverPath: null }],
  ]);
  const items = [
    { id: 11, productId: 1, productAttributeValueId: null, quantity: 1 },
    { id: 12, productId: 2, productAttributeValueId: null, quantity: 1 },
  ];

  it('blocks the whole order (no partial order) when any line is non-IN', () => {
    const res = resolveCheckoutLines({
      items,
      productsById,
      assortmentStatusByCategoryId: new Map([
        [10, 'IN_SCOPE'],
        [30, 'OUT_OF_SCOPE'],
      ]),
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.issues).toHaveLength(1);
      expect(res.issues[0]).toMatchObject({
        cartItemId: 12,
        code: 'unavailable',
        message: ASSORTMENT_OUT_CUSTOMER_MESSAGE,
        assortmentCode: 'ASSORTMENT_OUT_OF_SCOPE',
      });
    }
  });

  it('missing resolution blocks checkout (fail closed)', () => {
    const res = resolveCheckoutLines({
      items: [items[0]],
      productsById,
      assortmentStatusByCategoryId: new Map(),
    });
    expect(res.ok).toBe(false);
  });

  it('enforcement off (no map) → legacy behavior unchanged', () => {
    const res = resolveCheckoutLines({ items, productsById });
    expect(res.ok).toBe(true);
  });

  it('IN lines pass', () => {
    const res = resolveCheckoutLines({
      items: [items[0]],
      productsById,
      assortmentStatusByCategoryId: new Map([[10, 'IN_SCOPE']]),
    });
    expect(res.ok).toBe(true);
  });
});

describe('SCOPE-5/6 PDP direct access (reachable, not purchasable)', () => {
  const base = { status: 'in_stock', purchasable: true, quantity: 3 };
  it('IN → availability unchanged', () => {
    expect(
      applyAssortmentDecisionToAvailability(
        base,
        evaluateAssortmentCommerceGate('IN_SCOPE'),
      ),
    ).toBe(base);
  });
  it.each([
    ['OUT_OF_SCOPE', 'unavailable', ASSORTMENT_OUT_CUSTOMER_MESSAGE],
    ['REVIEW_REQUIRED', 'review_required', ASSORTMENT_REVIEW_CUSTOMER_MESSAGE],
    [null, 'review_required', ASSORTMENT_REVIEW_CUSTOMER_MESSAGE],
  ])('%s → %s', (status, state, msg) => {
    const out = applyAssortmentDecisionToAvailability(
      base,
      evaluateAssortmentCommerceGate(status as any),
    );
    expect(out).toEqual({
      ...base,
      purchasable: false,
      assortmentState: state,
      assortmentMessage: msg,
    });
    // Customer payload may use snake_case state tokens; never enums / versions / reason codes.
    expect(JSON.stringify(out)).not.toMatch(
      /OUT_OF_SCOPE|IN_SCOPE|REVIEW_REQUIRED|ASSORTMENT_|policyVersion|reasonCode/,
    );
  });
});

describe('SCOPE-5/6 historical orders stay readable', () => {
  it('order read paths do not depend on assortment enforcement', () => {
    const orderDir = path.join(__dirname, '..', '..', 'order');
    const files: string[] = fs
      .readdirSync(orderDir)
      .filter((f: string) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = fs.readFileSync(path.join(orderDir, f), 'utf8');
      expect(src).not.toMatch(/assortment/i);
    }
  });
});

describe('SCOPE-5/6 paste-link customer error mapping', () => {
  it.each([
    [
      'ASSORTMENT_OUT_OF_SCOPE',
      'PRODUCT_NOT_ORDERABLE',
      ASSORTMENT_OUT_CUSTOMER_MESSAGE,
    ],
    [
      'CATEGORY_OUT_OF_SCOPE',
      'PRODUCT_NOT_ORDERABLE',
      ASSORTMENT_OUT_CUSTOMER_MESSAGE,
    ],
    [
      'ASSORTMENT_REVIEW_REQUIRED',
      'PRODUCT_REVIEW_REQUIRED',
      ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
    ],
    [
      'POLICY_UNAVAILABLE',
      'PRODUCT_REVIEW_REQUIRED',
      ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
    ],
    [
      'POLICY_STALE',
      'PRODUCT_REVIEW_REQUIRED',
      ASSORTMENT_REVIEW_CUSTOMER_MESSAGE,
    ],
  ])(
    '%s → %s with fixed wording (crawler text never echoed)',
    (code, mapped, msg) => {
      const out = toCustomerSafeImportError(
        code,
        'Category 123 OUT_OF_SCOPE policyVersion=2 bulky',
      );
      expect(out.code).toBe(mapped);
      expect(out.message).toBe(msg);
      expect(out.message).not.toMatch(/OUT_OF_SCOPE|policyVersion|bulky|حجیم/);
    },
  );
});
