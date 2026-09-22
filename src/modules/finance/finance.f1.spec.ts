import {
  buildOrderItemCostSnapshot,
  isPresentCost,
  resolveEffectiveCost,
} from './cost-resolution';
import { CostSource, OrderItemCogsStatus } from './finance.types';
import { ProductCurrency } from '../product/entities/product.entity';
import {
  assertFin1SettlementEvidence,
  computeSettlementFromOrderSnapshot,
  getGatewayChargeIrt,
  LEGACY_TRANSACTION_SETTLEMENT_METADATA_MISSING,
} from './settlement-money';
import { normalizeOrderCogsToIrt } from './cogs-normalization';

describe('F1 cost-resolution', () => {
  it('treats zero as present and null as absent', () => {
    expect(isPresentCost(0)).toBe(true);
    expect(isPresentCost(null)).toBe(false);
    expect(isPresentCost(undefined)).toBe(false);
    expect(isPresentCost(Number.NaN)).toBe(false);
  });

  it('PAV override beats Product for landed and purchase', () => {
    const effective = resolveEffectiveCost(
      {
        purchaseCost: 10,
        landedUnitCost: 12,
        costCurrency: ProductCurrency.TRY,
        costSource: CostSource.manual_admin,
      },
      {
        purchaseCost: 0,
        landedUnitCost: 20,
        costCurrency: ProductCurrency.TRY,
        costSource: CostSource.manual_admin,
      },
    );
    expect(effective.purchaseCost).toBe(0);
    expect(effective.landedUnitCost).toBe(20);
    expect(effective.costCurrency).toBe(ProductCurrency.TRY);
    expect(effective.cogsStatus).toBe(OrderItemCogsStatus.captured);
  });

  it('inherits Product when PAV cost fields are null', () => {
    const effective = resolveEffectiveCost(
      {
        purchaseCost: 5,
        landedUnitCost: 7,
        costCurrency: ProductCurrency.TRY,
        costSource: CostSource.import_manual,
      },
      {
        purchaseCost: null,
        landedUnitCost: null,
        costCurrency: null,
        costSource: null,
      },
    );
    expect(effective.purchaseCost).toBe(5);
    expect(effective.landedUnitCost).toBe(7);
    expect(effective.costCurrency).toBe(ProductCurrency.TRY);
    expect(effective.cogsStatus).toBe(OrderItemCogsStatus.captured);
  });

  it('Product purchase + landed IRT with no PAV override stays IRT', () => {
    const effective = resolveEffectiveCost(
      {
        purchaseCost: 100,
        landedUnitCost: 1000,
        costCurrency: ProductCurrency.IRT,
        costSource: CostSource.manual_admin,
      },
      null,
    );
    expect(effective.purchaseCost).toBe(100);
    expect(effective.landedUnitCost).toBe(1000);
    expect(effective.costCurrency).toBe(ProductCurrency.IRT);
    expect(effective.cogsStatus).toBe(OrderItemCogsStatus.captured);
  });

  it('PAV overriding both costs in TRY keeps both TRY', () => {
    const effective = resolveEffectiveCost(
      {
        purchaseCost: 100,
        landedUnitCost: 1000,
        costCurrency: ProductCurrency.IRT,
        costSource: CostSource.manual_admin,
      },
      {
        purchaseCost: 1,
        landedUnitCost: 2,
        costCurrency: ProductCurrency.TRY,
        costSource: CostSource.manual_admin,
      },
    );
    expect(effective.purchaseCost).toBe(1);
    expect(effective.landedUnitCost).toBe(2);
    expect(effective.costCurrency).toBe(ProductCurrency.TRY);
    expect(effective.cogsStatus).toBe(OrderItemCogsStatus.captured);
  });

  it('PAV purchase TRY override must not relabel Product landed IRT', () => {
    const effective = resolveEffectiveCost(
      {
        purchaseCost: 50,
        landedUnitCost: 1000,
        costCurrency: ProductCurrency.IRT,
        costSource: CostSource.manual_admin,
      },
      {
        purchaseCost: 1,
        landedUnitCost: null,
        costCurrency: ProductCurrency.TRY,
        costSource: CostSource.manual_admin,
      },
    );
    expect(effective.landedUnitCost).toBe(1000);
    expect(effective.purchaseCost).toBe(1);
    expect(effective.costCurrency).toBeNull();
    expect(effective.cogsStatus).toBe(OrderItemCogsStatus.missing);
  });

  it('PAV landed TRY override with Product purchase IRT fails closed', () => {
    const effective = resolveEffectiveCost(
      {
        purchaseCost: 50,
        landedUnitCost: 1000,
        costCurrency: ProductCurrency.IRT,
        costSource: CostSource.manual_admin,
      },
      {
        purchaseCost: null,
        landedUnitCost: 2,
        costCurrency: ProductCurrency.TRY,
        costSource: CostSource.manual_admin,
      },
    );
    expect(effective.purchaseCost).toBe(50);
    expect(effective.landedUnitCost).toBe(2);
    expect(effective.costCurrency).toBeNull();
    expect(effective.cogsStatus).toBe(OrderItemCogsStatus.missing);
  });

  it('null remains null', () => {
    const effective = resolveEffectiveCost(
      {
        purchaseCost: null,
        landedUnitCost: null,
        costCurrency: null,
        costSource: null,
      },
      null,
    );
    expect(effective.purchaseCost).toBeNull();
    expect(effective.landedUnitCost).toBeNull();
    expect(effective.costCurrency).toBeNull();
  });

  it('explicit zero remains zero', () => {
    const effective = resolveEffectiveCost(
      {
        purchaseCost: 0,
        landedUnitCost: 0,
        costCurrency: ProductCurrency.IRT,
        costSource: CostSource.manual_admin,
      },
      null,
    );
    expect(effective.purchaseCost).toBe(0);
    expect(effective.landedUnitCost).toBe(0);
    expect(effective.costCurrency).toBe(ProductCurrency.IRT);
    expect(effective.cogsStatus).toBe(OrderItemCogsStatus.captured);
  });

  it('missing landed never becomes zero', () => {
    const effective = resolveEffectiveCost(
      {
        purchaseCost: 9,
        landedUnitCost: null,
        costCurrency: ProductCurrency.TRY,
        costSource: CostSource.manual_admin,
      },
      null,
    );
    expect(effective.landedUnitCost).toBeNull();
    expect(effective.cogsStatus).toBe(OrderItemCogsStatus.missing);
    const snap = buildOrderItemCostSnapshot(effective);
    expect(snap.unitLandedCostSnapshot).toBeNull();
    expect(snap.cogsStatus).toBe(OrderItemCogsStatus.missing);
  });

  it('does not silent-fallback purchase to landed', () => {
    const effective = resolveEffectiveCost(
      {
        purchaseCost: 100,
        landedUnitCost: null,
        costCurrency: ProductCurrency.TRY,
        costSource: CostSource.manual_admin,
      },
      null,
    );
    expect(effective.landedUnitCost).toBeNull();
    expect(effective.purchaseCost).toBe(100);
  });
});

describe('F1 COGS normalization', () => {
  it('1000 IRT only → 1000 IRT', () => {
    const r = normalizeOrderCogsToIrt(
      [
        {
          quantity: 1,
          unitLandedCostSnapshot: 1000,
          costCurrency: ProductCurrency.IRT,
          cogsStatus: OrderItemCogsStatus.captured,
        },
      ],
      3500,
    );
    expect(r).toEqual(expect.objectContaining({ ok: true, totalIrt: 1000 }));
  });

  it('1 TRY @ order FX 3500 → 3500 IRT', () => {
    const r = normalizeOrderCogsToIrt(
      [
        {
          quantity: 1,
          unitLandedCostSnapshot: 1,
          costCurrency: ProductCurrency.TRY,
          cogsStatus: OrderItemCogsStatus.captured,
        },
      ],
      3500,
    );
    expect(r).toEqual(
      expect.objectContaining({ ok: true, totalIrt: 3500, fxRateToIrt: 3500 }),
    );
  });

  it('1 TRY + 1000 IRT → 4500 IRT', () => {
    const r = normalizeOrderCogsToIrt(
      [
        {
          quantity: 1,
          unitLandedCostSnapshot: 1,
          costCurrency: ProductCurrency.TRY,
          cogsStatus: OrderItemCogsStatus.captured,
        },
        {
          quantity: 1,
          unitLandedCostSnapshot: 1000,
          costCurrency: ProductCurrency.IRT,
          cogsStatus: OrderItemCogsStatus.captured,
        },
      ],
      3500,
    );
    expect(r).toEqual(expect.objectContaining({ ok: true, totalIrt: 4500 }));
  });

  it('10 USD without USD→IRT snapshot → incomplete', () => {
    const r = normalizeOrderCogsToIrt(
      [
        {
          quantity: 1,
          unitLandedCostSnapshot: 10,
          costCurrency: ProductCurrency.USD,
          cogsStatus: OrderItemCogsStatus.captured,
        },
      ],
      3500,
    );
    expect(r).toEqual({ ok: false, reason: 'unsupported_currency' });
  });

  it('missing currency → incomplete', () => {
    const r = normalizeOrderCogsToIrt(
      [
        {
          quantity: 1,
          unitLandedCostSnapshot: 10,
          costCurrency: null,
          cogsStatus: OrderItemCogsStatus.captured,
        },
      ],
      3500,
    );
    expect(r).toEqual({ ok: false, reason: 'missing_currency' });
  });

  it('multiple TRY items use the same Order FX snapshot', () => {
    const r = normalizeOrderCogsToIrt(
      [
        {
          quantity: 2,
          unitLandedCostSnapshot: 1,
          costCurrency: ProductCurrency.TRY,
          cogsStatus: OrderItemCogsStatus.captured,
        },
        {
          quantity: 1,
          unitLandedCostSnapshot: 3,
          costCurrency: ProductCurrency.TRY,
          cogsStatus: OrderItemCogsStatus.captured,
        },
      ],
      3500,
    );
    expect(r).toEqual(expect.objectContaining({ ok: true, totalIrt: 17500 }));
  });

  it('does not use a changed live rate — only Order FX argument', () => {
    const r = normalizeOrderCogsToIrt(
      [
        {
          quantity: 1,
          unitLandedCostSnapshot: 1,
          costCurrency: ProductCurrency.TRY,
          cogsStatus: OrderItemCogsStatus.captured,
        },
      ],
      3500,
    );
    expect(r).toEqual(expect.objectContaining({ ok: true, totalIrt: 3500 }));
  });
});

describe('F1 settlement-money', () => {
  it('converts TRY commercial to IRT settlement via Order FX snapshot', () => {
    const s = computeSettlementFromOrderSnapshot({
      finalAmount: 100,
      commercialCurrency: ProductCurrency.TRY,
      fxRateToIrt: 3500,
    });
    expect(s.settlementCurrency).toBe(ProductCurrency.IRT);
    expect(s.settlementAmount).toBe(350000);
    expect(s.commercialAmount).toBe(100);
    expect(s.fxRateToIrt).toBe(3500);
  });

  it('rejects missing FX snapshot', () => {
    expect(() =>
      computeSettlementFromOrderSnapshot({
        finalAmount: 100,
        commercialCurrency: ProductCurrency.TRY,
        fxRateToIrt: null,
      }),
    ).toThrow('order_fx_snapshot_missing');
  });

  it('gateway charge is settlement minus wallet cover', () => {
    expect(getGatewayChargeIrt({ amount: 350000, walletAmount: 0 })).toBe(350000);
    expect(getGatewayChargeIrt({ amount: 350000, walletAmount: 50000 })).toBe(300000);
    expect(getGatewayChargeIrt({ amount: 350000, walletAmount: 350000 })).toBe(0);
  });

  it('rejects legacy pending transaction missing settlement metadata', () => {
    expect(() =>
      assertFin1SettlementEvidence(
        {
          amount: 50000,
          settlementCurrency: null,
          commercialAmount: null,
          commercialCurrency: null,
          fxRateToIrt: null,
        },
        { commercialCurrency: ProductCurrency.TRY, fxRateToIrt: 3500 },
      ),
    ).toThrow(LEGACY_TRANSACTION_SETTLEMENT_METADATA_MISSING);
  });

  it('rejects when Order FX is missing on resume/verify', () => {
    expect(() =>
      assertFin1SettlementEvidence(
        {
          amount: 350000,
          settlementCurrency: ProductCurrency.IRT,
          commercialAmount: 100,
          commercialCurrency: ProductCurrency.TRY,
          fxRateToIrt: 3500,
        },
        { commercialCurrency: ProductCurrency.TRY, fxRateToIrt: null },
      ),
    ).toThrow('order_fx_snapshot_missing');
  });

  it('accepts modern FIN-1 settlement evidence', () => {
    expect(() =>
      assertFin1SettlementEvidence(
        {
          amount: 350000,
          settlementCurrency: ProductCurrency.IRT,
          commercialAmount: 100,
          commercialCurrency: ProductCurrency.TRY,
          fxRateToIrt: 3500,
        },
        { commercialCurrency: ProductCurrency.TRY, fxRateToIrt: 3500 },
      ),
    ).not.toThrow();
  });
});
