import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import { ManualPaymentMethodEntity } from './entities/manual-payment-method.entity';
import { ManualPaymentRail } from './manual-payment.types';

@Injectable()
export class ManualPaymentMethodService {
  constructor(
    @InjectRepository(ManualPaymentMethodEntity)
    private readonly methodRepository: Repository<ManualPaymentMethodEntity>,
    private readonly error: ErrorService,
  ) {}

  amountWithinLimits(
    method: Pick<ManualPaymentMethodEntity, 'minAmountIrt' | 'maxAmountIrt'>,
    amountIrt: number,
  ): boolean {
    if (
      method.minAmountIrt != null &&
      amountIrt < Number(method.minAmountIrt)
    ) {
      return false;
    }
    if (
      method.maxAmountIrt != null &&
      amountIrt > Number(method.maxAmountIrt)
    ) {
      return false;
    }
    return true;
  }

  assertAmountLimitPair(
    minAmountIrt: number | null | undefined,
    maxAmountIrt: number | null | undefined,
  ): void {
    if (minAmountIrt != null) {
      if (!Number.isFinite(Number(minAmountIrt)) || Number(minAmountIrt) < 0) {
        this.error.unprocessableEntity(['حداقل مبلغ نامعتبر است']);
      }
    }
    if (maxAmountIrt != null) {
      if (!Number.isFinite(Number(maxAmountIrt)) || Number(maxAmountIrt) < 0) {
        this.error.unprocessableEntity(['حداکثر مبلغ نامعتبر است']);
      }
    }
    if (
      minAmountIrt != null &&
      maxAmountIrt != null &&
      Number(minAmountIrt) > Number(maxAmountIrt)
    ) {
      this.error.unprocessableEntity([
        'حداقل مبلغ نمی‌تواند از حداکثر بیشتر باشد',
      ]);
    }
  }

  async listEnabledForCustomer(params?: {
    amountIrt?: number;
  }): Promise<ManualPaymentMethodEntity[]> {
    const items = await this.methodRepository.find({
      where: { enabled: true },
      order: { displayOrder: 'ASC', id: 'ASC' },
    });
    if (params?.amountIrt == null) {
      return items;
    }
    return items.filter((m) => this.amountWithinLimits(m, params.amountIrt));
  }

  async listAllAdmin(): Promise<ManualPaymentMethodEntity[]> {
    return this.methodRepository.find({
      order: { displayOrder: 'ASC', id: 'ASC' },
    });
  }

  async getById(id: number): Promise<ManualPaymentMethodEntity> {
    const method = await this.methodRepository.findOne({ where: { id } });
    if (!method) {
      this.error.unprocessableEntity(['روش پرداخت دستی یافت نشد']);
    }
    return method;
  }

  async getByRail(rail: ManualPaymentRail): Promise<ManualPaymentMethodEntity> {
    const method = await this.methodRepository.findOne({ where: { rail } });
    if (!method) {
      this.error.unprocessableEntity(['روش پرداخت دستی یافت نشد']);
    }
    return method;
  }

  async updateMethod(
    key: { id?: number; rail?: ManualPaymentRail },
    patch: Partial<
      Pick<
        ManualPaymentMethodEntity,
        | 'enabled'
        | 'displayOrder'
        | 'customerInstructions'
        | 'minAmountIrt'
        | 'maxAmountIrt'
      >
    >,
  ): Promise<ManualPaymentMethodEntity> {
    const method =
      key.id != null
        ? await this.getById(key.id)
        : key.rail
          ? await this.getByRail(key.rail)
          : null;
    if (!method) {
      this.error.unprocessableEntity(['روش پرداخت دستی یافت نشد']);
    }

    const nextMin =
      patch.minAmountIrt !== undefined ? patch.minAmountIrt : method.minAmountIrt;
    const nextMax =
      patch.maxAmountIrt !== undefined ? patch.maxAmountIrt : method.maxAmountIrt;
    this.assertAmountLimitPair(nextMin, nextMax);

    Object.assign(method, patch, { updatedAt: new Date() });
    return this.methodRepository.save(method);
  }
}
