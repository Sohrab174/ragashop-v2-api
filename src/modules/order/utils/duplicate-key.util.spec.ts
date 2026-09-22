import { isOrderNumberUniqueViolation } from './duplicate-key.util';

describe('isOrderNumberUniqueViolation', () => {
  it('returns true only for uq_order_number duplicate key errors', () => {
    expect(
      isOrderNumberUniqueViolation({
        errno: 1062,
        sqlMessage: "Duplicate entry '1401011' for key 'uq_order_number'",
      }),
    ).toBe(true);
  });

  it('returns false for other duplicate key errors', () => {
    expect(
      isOrderNumberUniqueViolation({
        errno: 1062,
        sqlMessage: "Duplicate entry '5' for key 'uq_referral_award_orderId'",
      }),
    ).toBe(false);
  });
});
