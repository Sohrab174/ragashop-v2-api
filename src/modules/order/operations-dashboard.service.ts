import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OrderEntity, OrderStatus } from './entities/order.entity';
import { PaymentSubmissionEntity } from '../manual-payment/entities/payment-submission.entity';
import {
  ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES,
  PaymentSubmissionStatus,
} from '../manual-payment/manual-payment.types';
import { SupportRequestEntity } from '../support/entities/support-request.entity';
import { SupportStatus } from '../support/support.types';

export type OperationsDashboardCounts = {
  pendingReceiptReview: number;
  paidAwaitingPrep: number;
  acceptedAwaitingShip: number;
  supportNeedsAttention: number;
  ordersToday: number;
};

/**
 * Read-only operational counts for the Admin V2 dashboard.
 * Counts match employee list semantics (orders with at least one item).
 * Does not expose money aggregates (FX/mixed-currency stats are unreliable).
 */
@Injectable()
export class OperationsDashboardService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(PaymentSubmissionEntity)
    private readonly paymentSubmissionRepository: Repository<PaymentSubmissionEntity>,
    @InjectRepository(SupportRequestEntity)
    private readonly supportRequestRepository: Repository<SupportRequestEntity>,
  ) {}

  async getCounts(): Promise<OperationsDashboardCounts> {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayDate = `${yyyy}-${mm}-${dd}`;

    const [
      pendingReceiptReview,
      paidAwaitingPrep,
      acceptedAwaitingShip,
      supportNeedsAttention,
      ordersToday,
    ] = await Promise.all([
      this.paymentSubmissionRepository.count({
        where: {
          status: In(
            ACTIVE_MANUAL_PAYMENT_HOLD_STATUSES as PaymentSubmissionStatus[],
          ),
        },
      }),
      this.countOrdersByStatus(OrderStatus.paid),
      this.countOrdersByStatus(OrderStatus.accepted),
      this.supportRequestRepository.count({
        where: { status: SupportStatus.waitingForSupport },
      }),
      this.countOrdersCreatedOn(todayDate),
    ]);

    return {
      pendingReceiptReview: Number(pendingReceiptReview) || 0,
      paidAwaitingPrep: Number(paidAwaitingPrep) || 0,
      acceptedAwaitingShip: Number(acceptedAwaitingShip) || 0,
      supportNeedsAttention: Number(supportNeedsAttention) || 0,
      ordersToday: Number(ordersToday) || 0,
    };
  }

  private countOrdersByStatus(status: OrderStatus): Promise<number> {
    return this.orderRepository
      .createQueryBuilder('order')
      .innerJoin('order.orderItems', 'orderItems')
      .where('order.status = :status', { status })
      .getCount();
  }

  private countOrdersCreatedOn(date: string): Promise<number> {
    return this.orderRepository
      .createQueryBuilder('order')
      .innerJoin('order.orderItems', 'orderItems')
      .where('DATE(order.createdAt) = :date', { date })
      .getCount();
  }
}
