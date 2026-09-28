import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import { OrderEntity } from '../order/entities/order.entity';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { SupportRequestEntity } from './entities/support-request.entity';
import { SupportMessageEntity } from './entities/support-message.entity';
import {
  CreateSupportMessageDto,
  CreateSupportRequestDto,
  UpdateSupportStatusDto,
} from './dto/support.dto';
import {
  SUPPORT_MESSAGE_MAX,
  SUPPORT_SUBJECT_MAX,
  SupportSenderType,
  SupportStatus,
  isSupportCategory,
  isSupportStatus,
  supportCategoryLabel,
  supportStatusLabel,
} from './support.types';

const LIST_LIMIT = 50;

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportRequestEntity)
    private readonly requestRepository: Repository<SupportRequestEntity>,
    @InjectRepository(SupportMessageEntity)
    private readonly messageRepository: Repository<SupportMessageEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    private readonly error: ErrorService,
  ) {}

  async createForCustomer(customerId: number, dto: CreateSupportRequestDto) {
    this.assertCustomer(customerId);
    const subject = this.cleanSubject(dto.subject);
    const message = this.cleanMessage(dto.message);
    if (!isSupportCategory(String(dto.category))) {
      this.error.unprocessableEntity(['دسته پشتیبانی نامعتبر است']);
    }
    const order = await this.ownedOrder(customerId, dto.orderId);
    const now = new Date();
    const inserted = await this.requestRepository
      .createQueryBuilder()
      .insert()
      .values({
        customerId,
        orderId: order?.id ?? null,
        category: dto.category,
        subject,
        status: SupportStatus.waitingForSupport,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const id = Number(inserted.identifiers[0].id);
    await this.appendMessage({
      supportRequestId: id,
      senderType: SupportSenderType.customer,
      customerId,
      userId: null,
      body: message,
      createdAt: now,
    });
    return this.getForCustomer(customerId, id);
  }

  async listForCustomer(customerId: number) {
    this.assertCustomer(customerId);
    const rows = await this.requestRepository
      .createQueryBuilder('request')
      .leftJoin(OrderEntity, 'order', 'order.id = request.orderId')
      .where('request.customerId = :customerId', { customerId })
      .orderBy('request.updatedAt', 'DESC')
      .addOrderBy('request.id', 'DESC')
      .limit(LIST_LIMIT)
      .select([
        'request.id AS id',
        'request.category AS category',
        'request.subject AS subject',
        'request.status AS status',
        'request.orderId AS orderId',
        'order.number AS orderNumber',
        'request.createdAt AS createdAt',
        'request.updatedAt AS updatedAt',
      ])
      .getRawMany();
    return rows.map((row) => this.toListItem(row));
  }

  async getForCustomer(customerId: number, requestId: number) {
    const request = await this.ownedRequest(customerId, requestId);
    return this.toDetail(request, false);
  }

  async replyAsCustomer(
    customerId: number,
    requestId: number,
    dto: CreateSupportMessageDto,
  ) {
    const request = await this.ownedRequest(customerId, requestId);
    if (request.status === SupportStatus.resolved) {
      this.error.unprocessableEntity([
        'این درخواست بسته شده است. درخواست جدیدی ثبت کنید.',
      ]);
    }
    const message = this.cleanMessage(dto.message);
    const now = new Date();
    await this.appendMessage({
      supportRequestId: request.id,
      senderType: SupportSenderType.customer,
      customerId,
      userId: null,
      body: message,
      createdAt: now,
    });
    await this.requestRepository.update(request.id, {
      status: SupportStatus.waitingForSupport,
      updatedAt: now,
    });
    return this.getForCustomer(customerId, request.id);
  }

  async listForStaff() {
    const rows = await this.requestRepository
      .createQueryBuilder('request')
      .leftJoin(OrderEntity, 'order', 'order.id = request.orderId')
      .leftJoin(CustomerEntity, 'customer', 'customer.id = request.customerId')
      .orderBy('request.updatedAt', 'DESC')
      .limit(LIST_LIMIT)
      .select([
        'request.id AS id',
        'request.customerId AS customerId',
        'request.category AS category',
        'request.subject AS subject',
        'request.status AS status',
        'request.orderId AS orderId',
        'order.number AS orderNumber',
        'customer.firstName AS firstName',
        'customer.lastName AS lastName',
        'customer.mobile AS mobile',
        'request.createdAt AS createdAt',
        'request.updatedAt AS updatedAt',
      ])
      .getRawMany();
    return rows.map((row) => ({
      ...this.toListItem(row),
      customerId: Number(row.customerId),
      customerName: [row.firstName, row.lastName].filter(Boolean).join(' '),
      customerMobile: row.mobile || null,
    }));
  }

  async getForStaff(requestId: number) {
    const request = await this.findRequest(requestId);
    if (!request) {
      this.error.unprocessableEntity(['درخواست پشتیبانی یافت نشد']);
    }
    const detail = await this.toDetail(request, true);
    const customer = await this.requestRepository.manager
      .getRepository(CustomerEntity)
      .findOne({ where: { id: request.customerId } });
    return {
      ...detail,
      customerId: request.customerId,
      customerName: customer
        ? [customer.firstName, customer.lastName].filter(Boolean).join(' ')
        : '',
      customerMobile: customer?.mobile || null,
    };
  }

  async replyAsStaff(userId: number, requestId: number, dto: CreateSupportMessageDto) {
    if (!Number.isInteger(Number(userId)) || Number(userId) < 1) {
      this.error.forbidden(['دسترسی مجاز نیست']);
    }
    const request = await this.findRequest(requestId);
    if (!request) {
      this.error.unprocessableEntity(['درخواست پشتیبانی یافت نشد']);
    }
    const message = this.cleanMessage(dto.message);
    const now = new Date();
    await this.appendMessage({
      supportRequestId: request.id,
      senderType: SupportSenderType.staff,
      customerId: null,
      userId: Number(userId),
      body: message,
      createdAt: now,
    });
    const nextStatus =
      request.status === SupportStatus.resolved
        ? SupportStatus.resolved
        : SupportStatus.waitingForCustomer;
    await this.requestRepository.update(request.id, {
      status: nextStatus,
      updatedAt: now,
    });
    return this.getForStaff(request.id);
  }

  async updateStatus(requestId: number, dto: UpdateSupportStatusDto) {
    if (!isSupportStatus(String(dto.status))) {
      this.error.unprocessableEntity(['وضعیت پشتیبانی نامعتبر است']);
    }
    const request = await this.findRequest(requestId);
    if (!request) {
      this.error.unprocessableEntity(['درخواست پشتیبانی یافت نشد']);
    }
    await this.requestRepository.update(request.id, {
      status: dto.status,
      updatedAt: new Date(),
    });
    return this.getForStaff(request.id);
  }

  private async ownedOrder(customerId: number, orderId?: number) {
    if (orderId == null) return null;
    const id = Number(orderId);
    if (!Number.isInteger(id) || id < 1) {
      this.error.unprocessableEntity(['سفارش معتبر نیست']);
    }
    const order = await this.orderRepository.findOne({
      where: { id, customerId, isDeleted: false },
    });
    if (!order) {
      this.error.unprocessableEntity([
        'این سفارش به حساب شما تعلق ندارد',
      ]);
    }
    return order;
  }

  private async ownedRequest(customerId: number, requestId: number) {
    const id = Number(requestId);
    if (!Number.isInteger(id) || id < 1) {
      this.error.unprocessableEntity(['درخواست پشتیبانی یافت نشد']);
    }
    const request = await this.requestRepository.findOne({
      where: { id, customerId },
    });
    if (!request) {
      this.error.unprocessableEntity(['درخواست پشتیبانی یافت نشد']);
    }
    return request;
  }

  private async findRequest(requestId: number) {
    const id = Number(requestId);
    if (!Number.isInteger(id) || id < 1) return null;
    return this.requestRepository.findOne({ where: { id } });
  }

  private async toDetail(request: SupportRequestEntity, includeStaffId: boolean) {
    const messages = await this.messageRepository.find({
      where: { supportRequestId: request.id },
      order: { id: 'ASC' },
    });
    let orderNumber: string | null = null;
    if (request.orderId) {
      const order = await this.orderRepository.findOne({
        where: { id: request.orderId },
      });
      orderNumber = order?.number || null;
    }
    return {
      id: request.id,
      category: request.category,
      categoryLabel: supportCategoryLabel(request.category),
      subject: request.subject,
      status: request.status,
      statusLabel: supportStatusLabel(request.status),
      orderId: request.orderId,
      orderNumber,
      createdAt: this.iso(request.createdAt),
      updatedAt: this.iso(request.updatedAt),
      canReply: request.status !== SupportStatus.resolved,
      messages: messages.map((message) => ({
        id: message.id,
        senderType: message.senderType,
        senderLabel:
          message.senderType === SupportSenderType.staff
            ? 'پشتیبانی راگاشاپ'
            : 'شما',
        ...(includeStaffId ? { userId: message.userId } : {}),
        body: message.body,
        createdAt: this.iso(message.createdAt),
      })),
    };
  }

  private toListItem(row: Record<string, unknown>) {
    return {
      id: Number(row.id),
      category: String(row.category),
      categoryLabel: supportCategoryLabel(String(row.category)),
      subject: String(row.subject || ''),
      status: String(row.status),
      statusLabel: supportStatusLabel(String(row.status)),
      orderId: row.orderId == null ? null : Number(row.orderId),
      orderNumber: row.orderNumber ? String(row.orderNumber) : null,
      createdAt: this.iso(row.createdAt as Date),
      updatedAt: this.iso(row.updatedAt as Date),
    };
  }

  private async appendMessage(values: {
    supportRequestId: number;
    senderType: SupportSenderType;
    customerId: number | null;
    userId: number | null;
    body: string;
    createdAt: Date;
  }) {
    await this.messageRepository
      .createQueryBuilder()
      .insert()
      .values(values)
      .execute();
  }

  private cleanSubject(value: unknown): string {
    const subject = String(value || '').trim();
    if (!subject) {
      this.error.unprocessableEntity(['موضوع الزامی است']);
    }
    if (subject.length > SUPPORT_SUBJECT_MAX) {
      this.error.unprocessableEntity(['موضوع طولانی است']);
    }
    return subject;
  }

  private cleanMessage(value: unknown): string {
    const message = String(value || '').replace(/\u0000/g, '').trim();
    if (!message) {
      this.error.unprocessableEntity(['متن پیام الزامی است']);
    }
    if (message.length > SUPPORT_MESSAGE_MAX) {
      this.error.unprocessableEntity(['متن پیام طولانی است']);
    }
    return message;
  }

  private assertCustomer(customerId: number) {
    if (!Number.isInteger(Number(customerId)) || Number(customerId) < 1) {
      this.error.forbidden(['دسترسی مجاز نیست']);
    }
  }

  private iso(value: Date | string | null) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
}
