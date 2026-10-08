import { OrderStatus } from './entities/order.entity';
import { SupportStatus } from '../support/support.types';
import { PaymentSubmissionStatus } from '../manual-payment/manual-payment.types';
import { OperationsDashboardService } from './operations-dashboard.service';

describe('OperationsDashboardService', () => {
  function harness(overrides: {
    paymentCount?: number;
    paidCount?: number;
    acceptedCount?: number;
    supportCount?: number;
    todayCount?: number;
  } = {}) {
    let pendingStatus: OrderStatus | null = null;
    let pendingDate: string | null = null;

    const orderQb: any = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation((clause: string, params: any) => {
        if (clause.includes('order.status')) {
          pendingStatus = params.status;
          pendingDate = null;
        }
        if (clause.includes('DATE(order.createdAt)')) {
          pendingDate = params.date;
          pendingStatus = null;
        }
        return orderQb;
      }),
      getCount: jest.fn().mockImplementation(async () => {
        if (pendingStatus === OrderStatus.paid) return overrides.paidCount ?? 3;
        if (pendingStatus === OrderStatus.accepted) return overrides.acceptedCount ?? 2;
        if (pendingDate) return overrides.todayCount ?? 5;
        return 0;
      }),
    };

    const orderRepository = {
      createQueryBuilder: jest.fn(() => orderQb),
    };

    const paymentSubmissionRepository = {
      count: jest.fn().mockResolvedValue(overrides.paymentCount ?? 4),
    };

    const supportRequestRepository = {
      count: jest.fn().mockResolvedValue(overrides.supportCount ?? 1),
    };

    const service = new OperationsDashboardService(
      orderRepository as any,
      paymentSubmissionRepository as any,
      supportRequestRepository as any,
    );

    return {
      service,
      paymentSubmissionRepository,
      supportRequestRepository,
    };
  }

  it('returns operational queue counts from read-only repositories', async () => {
    const { service, paymentSubmissionRepository, supportRequestRepository } =
      harness({
        paymentCount: 7,
        paidCount: 11,
        acceptedCount: 9,
        supportCount: 2,
        todayCount: 13,
      });

    const counts = await service.getCounts();

    expect(counts).toEqual({
      pendingReceiptReview: 7,
      paidAwaitingPrep: 11,
      acceptedAwaitingShip: 9,
      supportNeedsAttention: 2,
      ordersToday: 13,
    });

    const paymentWhere = paymentSubmissionRepository.count.mock.calls[0][0].where;
    expect(paymentWhere.status.value).toEqual(
      expect.arrayContaining([
        PaymentSubmissionStatus.SUBMITTED,
        PaymentSubmissionStatus.UNDER_REVIEW,
      ]),
    );

    expect(supportRequestRepository.count).toHaveBeenCalledWith({
      where: { status: SupportStatus.waitingForSupport },
    });
  });

  it('coerces null/undefined repository counts to zero', async () => {
    const { service, paymentSubmissionRepository, supportRequestRepository } =
      harness();
    paymentSubmissionRepository.count.mockResolvedValue(null);
    supportRequestRepository.count.mockResolvedValue(undefined);

    const counts = await service.getCounts();
    expect(counts.pendingReceiptReview).toBe(0);
    expect(counts.supportNeedsAttention).toBe(0);
  });
});
