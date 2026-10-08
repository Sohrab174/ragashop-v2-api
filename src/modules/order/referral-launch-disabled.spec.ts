import { OrderService } from './order.service';
import { FinancialEventType } from '../finance/finance.types';

/**
 * ADMIN-V2-0 FIX C: with referral disabled (default fail-closed),
 * successful payment finalization must NOT create referral credit/events,
 * while COGS recognition remains unchanged.
 */
describe('referral disabled during payment finalization (ADMIN-V2-0)', () => {
  const previous = process.env.REFERRAL_AWARDS_ENABLED;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.REFERRAL_AWARDS_ENABLED;
    } else {
      process.env.REFERRAL_AWARDS_ENABLED = previous;
    }
  });

  function buildService(opts: { insertIdempotent: jest.Mock; manager: any }) {
    const service = Object.create(OrderService.prototype) as OrderService;
    (service as any).financialEventService = {
      insertIdempotent: opts.insertIdempotent,
    };
    (service as any).error = {
      unprocessableEntity: (m: string[]) => {
        throw new Error(m[0]);
      },
      methodNotAllowed: (m: string[]) => {
        throw new Error(m[0]);
      },
    };
    return service;
  }

  it('H — applyReferralRewardsAtomic is a no-op when gate is off', async () => {
    delete process.env.REFERRAL_AWARDS_ENABLED;
    const manager = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      increment: jest.fn(),
    };
    const insertIdempotent = jest.fn();
    const service = buildService({ insertIdempotent, manager });
    const queryRunner = { manager } as any;

    await service.applyReferralRewardsAtomic(99, queryRunner);

    expect(manager.findOne).not.toHaveBeenCalled();
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
    expect(manager.increment).not.toHaveBeenCalled();
    expect(insertIdempotent).not.toHaveBeenCalled();
  });

  it('H — even with REFERRAL_AWARDS_ENABLED=false, no award path runs', async () => {
    process.env.REFERRAL_AWARDS_ENABLED = 'false';
    const manager = {
      findOne: jest.fn(async () => ({
        id: 1,
        amount: 100,
        discount: 0,
        customerId: 2,
        customer: { inviteCode: 'ABC' },
      })),
    };
    const insertIdempotent = jest.fn();
    const service = buildService({ insertIdempotent, manager });
    await service.applyReferralRewardsAtomic(1, { manager } as any);
    expect(manager.findOne).not.toHaveBeenCalled();
    expect(insertIdempotent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: FinancialEventType.REFERRAL_COMMISSION_EARNED,
      }),
    );
  });

  it('I — finalizeOrderPaymentAtomic still recognizes COGS when referral is disabled', async () => {
    delete process.env.REFERRAL_AWARDS_ENABLED;
    const service = buildService({
      insertIdempotent: jest.fn(),
      manager: {},
    });
    const recognize = jest
      .spyOn(service, 'recognizeCogsFromOrderItemSnapshots')
      .mockResolvedValue(undefined);
    const applyReferral = jest
      .spyOn(service, 'applyReferralRewardsAtomic')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service, 'claimOrderPaymentFinalization')
      .mockResolvedValue('claimed' as any);
    jest.spyOn(service, 'markOrderPaidAtomic').mockResolvedValue('newly_paid');

    const result = await service.finalizeOrderPaymentAtomic(5, 9, {} as any);

    expect(result).toBe('finalized');
    expect(recognize).toHaveBeenCalledWith(5, expect.anything());
    expect(applyReferral).toHaveBeenCalledWith(5, expect.anything());
    // applyReferral itself is gated; the finalize path still invokes it (no-op).
  });
});
