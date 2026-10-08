import { HttpException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SupportService } from './support.service';
import { SupportSenderType, SupportStatus } from './support.types';

function errorDouble() {
  return {
    unprocessableEntity: (messages: string[]) => {
      throw new HttpException({ messages }, 422);
    },
    forbidden: (messages: string[]) => {
      throw new HttpException({ messages }, 403);
    },
  };
}

describe('SupportService ownership', () => {
  function harness() {
    const requests: any[] = [];
    const messages: any[] = [];
    let nextRequest = 1;
    let nextMessage = 1;
    const orders = [{ id: 516, customerId: 4, isDeleted: false, number: '1405076' }];

    const requestRepository = {
      createQueryBuilder: () => {
        const state: any = { kind: '', values: null };
        const qb: any = {
          insert: () => {
            state.kind = 'insert';
            return qb;
          },
          values: (value: any) => {
            state.values = value;
            return qb;
          },
          execute: async () => {
            const id = nextRequest++;
            requests.push({ id, ...state.values });
            return { identifiers: [{ id }] };
          },
          leftJoin: () => qb,
          where: () => qb,
          orderBy: () => qb,
          addOrderBy: () => qb,
          limit: () => qb,
          select: () => qb,
          getRawMany: async () =>
            requests
              .filter((row) => row.customerId === 4)
              .map((row) => ({
                ...row,
                orderNumber: '1405076',
              })),
        };
        return qb;
      },
      findOne: async ({ where }: any) =>
        requests.find((row) => {
          if (where.customerId != null && row.customerId !== where.customerId) {
            return false;
          }
          return row.id === where.id;
        }) || null,
      update: async (id: number, patch: any) => {
        const row = requests.find((item) => item.id === id);
        Object.assign(row, patch);
      },
      manager: {
        getRepository: () => ({
          findOne: async () => ({
            id: 4,
            firstName: 'مهسا',
            lastName: 'حساب‌یک',
            mobile: '+989127771001',
          }),
        }),
      },
    };
    const messageRepository = {
      createQueryBuilder: () => {
        const state: any = {};
        const qb: any = {
          insert: () => qb,
          values: (value: any) => {
            state.values = value;
            return qb;
          },
          execute: async () => {
            messages.push({ id: nextMessage++, ...state.values });
          },
        };
        return qb;
      },
      find: async ({ where }: any) =>
        messages.filter((row) => row.supportRequestId === where.supportRequestId),
    };
    const orderRepository = {
      findOne: async ({ where }: any) =>
        orders.find((order) => {
          if (where.customerId != null && order.customerId !== where.customerId) {
            return false;
          }
          if (where.isDeleted != null && order.isDeleted !== where.isDeleted) {
            return false;
          }
          return order.id === where.id;
        }) || null,
    };
    const service = new SupportService(
      requestRepository as any,
      messageRepository as any,
      orderRepository as any,
      errorDouble() as any,
    );
    return { service, requests, messages };
  }

  it('creates a request for the authenticated customer and ignores extra identity fields', async () => {
    const { service, requests, messages } = harness();
    const detail = await service.createForCustomer(4, {
      category: 'order',
      subject: ' پیگیری سفارش ',
      message: 'سلام، وضعیت سفارش را می‌خواستم.',
      orderId: 516,
      customerId: 99,
      status: 'RESOLVED',
      senderType: 'STAFF',
    } as any);
    expect(requests[0].customerId).toBe(4);
    expect(requests[0].orderId).toBe(516);
    expect(requests[0].status).toBe(SupportStatus.waitingForSupport);
    expect(messages[0].senderType).toBe(SupportSenderType.customer);
    expect(messages[0].userId).toBeNull();
    expect(detail.subject).toBe('پیگیری سفارش');
    expect(detail).not.toHaveProperty('customerId');
  });

  it('rejects another customer order', async () => {
    const { service } = harness();
    await expect(
      service.createForCustomer(4, {
        category: 'order',
        subject: 'سفارش دیگران',
        message: 'این سفارش مال من نیست',
        orderId: 999,
      } as any),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('hides another customer request', async () => {
    const { service } = harness();
    await service.createForCustomer(4, {
      category: 'other',
      subject: 'حساب',
      message: 'کمک',
    } as any);
    await expect(service.getForCustomer(8, 1)).rejects.toBeInstanceOf(HttpException);
  });

  it('appends a customer reply and does not let the customer set staff sender', async () => {
    const { service, messages } = harness();
    await service.createForCustomer(4, {
      category: 'account',
      subject: 'ورود',
      message: 'اول',
    } as any);
    const detail = await service.replyAsCustomer(4, 1, {
      message: 'پیگیری',
      senderType: 'STAFF',
    } as any);
    expect(messages).toHaveLength(2);
    expect(messages[1].senderType).toBe(SupportSenderType.customer);
    expect(detail.messages).toHaveLength(2);
    expect(detail.status).toBe(SupportStatus.waitingForSupport);
  });

  it('blocks customer replies after resolve', async () => {
    const { service, requests } = harness();
    await service.createForCustomer(4, {
      category: 'other',
      subject: 'بسته',
      message: 'اول',
    } as any);
    requests[0].status = SupportStatus.resolved;
    await expect(
      service.replyAsCustomer(4, 1, { message: 'بعد' } as any),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('records an admin reply as staff and can change status explicitly', async () => {
    const { service, messages } = harness();
    await service.createForCustomer(4, {
      category: 'payment',
      subject: 'پرداخت',
      message: 'رسید را فرستادم',
    } as any);
    const replied = await service.replyAsStaff(3, 1, {
      message: 'رسید بررسی شد.',
    } as any);
    expect(messages[1].senderType).toBe(SupportSenderType.staff);
    expect(messages[1].userId).toBe(3);
    expect(replied.status).toBe(SupportStatus.waitingForCustomer);
    const updated = await service.updateStatus(1, {
      status: SupportStatus.resolved,
    } as any);
    expect(updated.status).toBe(SupportStatus.resolved);
  });
});

describe('support admin authorization contract', () => {
  it('requires the support capability on staff routes and does not expose customer status writes', () => {
    const source = readFileSync(join(__dirname, 'support.controller.ts'), 'utf8');
    expect(source).toContain('UserCapabilityName.support_read');
    expect(source).toContain('UserCapabilityName.support_reply');
    expect(source).toContain('UserCapabilityName.support_manage');
    expect(source).toContain("@Roles(UserRoles.admin, UserRoles.employee)");
    expect(source).not.toMatch(/statusMine|replyMine[\s\S]*senderType/);
    const customerCreate = source.slice(
      source.indexOf('async createMine'),
      source.indexOf('async getMine'),
    );
    expect(customerCreate).not.toContain('status');
  });
});
