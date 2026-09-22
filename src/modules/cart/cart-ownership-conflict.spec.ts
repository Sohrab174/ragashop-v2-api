import {
  CART_OWNERSHIP_ADD_MAX_ATTEMPTS,
  isCartOwnershipUniqueViolation,
  withCartOwnershipConflictRetry,
} from './cart-ownership-conflict.util';
import { clampCartQuantityAgainstStock } from './cart-stock';

describe('isCartOwnershipUniqueViolation', () => {
  it('detects guest sessionKey ownership race', () => {
    expect(
      isCartOwnershipUniqueViolation({
        errno: 1062,
        code: 'ER_DUP_ENTRY',
        sqlMessage:
          "Duplicate entry '550e8400-e29b-41d4-a716-446655440000' for key 'uq_cart_sessionKey'",
      }),
    ).toBe(true);
  });

  it('detects customerId ownership race', () => {
    expect(
      isCartOwnershipUniqueViolation({
        errno: 1062,
        sqlMessage: "Duplicate entry '42' for key 'uq_cart_customerId'",
      }),
    ).toBe(true);
  });

  it('detects TypeORM-wrapped driverError ownership race', () => {
    expect(
      isCartOwnershipUniqueViolation({
        message: 'QueryFailedError',
        driverError: {
          errno: 1062,
          code: 'ER_DUP_ENTRY',
          sqlMessage: "Duplicate entry 'x' for key 'uq_cart_sessionKey'",
        },
      }),
    ).toBe(true);
  });

  it('does not treat cart_item config unique as ownership race', () => {
    expect(
      isCartOwnershipUniqueViolation({
        errno: 1062,
        sqlMessage:
          "Duplicate entry '1-10:0' for key 'uq_cart_item_cart_config'",
      }),
    ).toBe(false);
  });

  it('does not swallow unrelated DB errors', () => {
    expect(
      isCartOwnershipUniqueViolation({
        code: 'ER_LOCK_WAIT_TIMEOUT',
        errno: 1205,
        sqlMessage: 'Lock wait timeout exceeded',
      }),
    ).toBe(false);
    expect(isCartOwnershipUniqueViolation(new Error('connection lost'))).toBe(
      false,
    );
  });
});

describe('withCartOwnershipConflictRetry', () => {
  it('retries once on new-guest Cart ownership unique race then succeeds', async () => {
    let calls = 0;
    const value = await withCartOwnershipConflictRetry(async () => {
      calls += 1;
      if (calls === 1) {
        throw {
          errno: 1062,
          sqlMessage: "Duplicate entry 'sess' for key 'uq_cart_sessionKey'",
        };
      }
      // Second attempt: winner Cart already exists → merge path
      return { cartCount: 1, lineCount: 1, quantity: 2 };
    });
    expect(calls).toBe(2);
    expect(value).toEqual({ cartCount: 1, lineCount: 1, quantity: 2 });
  });

  it('retries once on new-customer Cart ownership unique race then succeeds', async () => {
    let calls = 0;
    const value = await withCartOwnershipConflictRetry(async () => {
      calls += 1;
      if (calls === 1) {
        throw {
          errno: 1062,
          sqlMessage: "Duplicate entry '7' for key 'uq_cart_customerId'",
        };
      }
      return { cartCount: 1, lineCount: 1, quantity: 2 };
    });
    expect(calls).toBe(CART_OWNERSHIP_ADD_MAX_ATTEMPTS);
    expect(value.quantity).toBe(2);
  });

  it('does not retry cart_item unique or unrelated errors', async () => {
    await expect(
      withCartOwnershipConflictRetry(async () => {
        throw {
          errno: 1062,
          sqlMessage:
            "Duplicate entry '1-10:5' for key 'uq_cart_item_cart_config'",
        };
      }),
    ).rejects.toMatchObject({ errno: 1062 });

    await expect(
      withCartOwnershipConflictRetry(async () => {
        throw new Error('ECONNRESET');
      }),
    ).rejects.toThrow('ECONNRESET');
  });

  it('is bounded to a single retry', async () => {
    let calls = 0;
    await expect(
      withCartOwnershipConflictRetry(async () => {
        calls += 1;
        throw {
          errno: 1062,
          sqlMessage: "Duplicate entry 'sess' for key 'uq_cart_sessionKey'",
        };
      }),
    ).rejects.toMatchObject({ errno: 1062 });
    expect(calls).toBe(CART_OWNERSHIP_ADD_MAX_ATTEMPTS);
  });
});

describe('CART1-I1 stock safety after ownership race recovery', () => {
  it('combined qty still respects finite stock=1 (second merge must fail)', () => {
    // After loser retries, it loads winner Cart + existing line qty=1,
    // then attempts nextQty = 1 + 1 against maxQuantity=1.
    const clamped = clampCartQuantityAgainstStock(2, {
      maxQuantity: 1,
      available: true,
    });
    expect(clamped.ok).toBe(false);
    if (clamped.ok === false) {
      expect(clamped.reason).toBe('exceeds_stock');
    }
  });

  it('combined qty allowed when finite stock >= 2', () => {
    const clamped = clampCartQuantityAgainstStock(2, {
      maxQuantity: 2,
      available: true,
    });
    expect(clamped.ok).toBe(true);
    if (clamped.ok === true) {
      expect(clamped.quantity).toBe(2);
    }
  });
});
