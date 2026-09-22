import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import { BankDestinationEntity } from './entities/bank-destination.entity';
import { ManualPaymentRail } from './manual-payment.types';
import { getLastDisplayOrder } from '../../utils/last-display-order';
import {
  isValidIranCardNumber,
  isValidIranSheba,
  normalizeCardNumber,
  normalizeIban,
} from './utils/iran-bank-identifiers';

@Injectable()
export class BankDestinationService {
  constructor(
    @InjectRepository(BankDestinationEntity)
    private readonly destinationRepository: Repository<BankDestinationEntity>,
    private readonly error: ErrorService,
  ) {}

  assertRailCompatibility(
    destination: Pick<
      BankDestinationEntity,
      'cardNumber' | 'iban' | 'accountNumber' | 'allowedRails'
    >,
    rail: ManualPaymentRail,
  ): void {
    const rails = destination.allowedRails || [];
    if (!rails.includes(rail)) {
      this.error.unprocessableEntity([
        'این مقصد بانکی برای روش انتخاب‌شده فعال نیست',
      ]);
    }

    if (rail === ManualPaymentRail.CARD_TO_CARD) {
      if (!isValidIranCardNumber(destination.cardNumber)) {
        this.error.unprocessableEntity([
          'برای کارت‌به‌کارت شماره کارت مقصد معتبر الزامی است',
        ]);
      }
      return;
    }

    // PAYA / POL / SATNA require a valid Sheba; accountNumber alone is insufficient.
    if (!isValidIranSheba(destination.iban)) {
      this.error.unprocessableEntity([
        'برای این روش، شبا معتبر مقصد الزامی است',
      ]);
    }
  }

  amountWithinLimits(
    destination: Pick<BankDestinationEntity, 'minAmountIrt' | 'maxAmountIrt'>,
    amountIrt: number,
  ): boolean {
    if (
      destination.minAmountIrt != null &&
      amountIrt < Number(destination.minAmountIrt)
    ) {
      return false;
    }
    if (
      destination.maxAmountIrt != null &&
      amountIrt > Number(destination.maxAmountIrt)
    ) {
      return false;
    }
    return true;
  }

  /**
   * Validate min/max are non-negative and min <= max when both set.
   */
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

  assertEnabledRailsHaveIdentifiers(
    enabled: boolean,
    allowedRails: ManualPaymentRail[],
    cardNumber: string | null | undefined,
    iban: string | null | undefined,
  ): void {
    if (!enabled) {
      return;
    }
    for (const rail of allowedRails || []) {
      if (rail === ManualPaymentRail.CARD_TO_CARD) {
        if (!isValidIranCardNumber(cardNumber)) {
          this.error.unprocessableEntity([
            'فعال‌سازی کارت‌به‌کارت بدون شماره کارت معتبر مجاز نیست',
          ]);
        }
      } else if (
        rail === ManualPaymentRail.PAYA ||
        rail === ManualPaymentRail.POL ||
        rail === ManualPaymentRail.SATNA
      ) {
        if (!isValidIranSheba(iban)) {
          this.error.unprocessableEntity([
            'فعال‌سازی پایا/پل/ساتنا بدون شبا معتبر مجاز نیست',
          ]);
        }
      }
    }
  }

  async listForCustomer(params: {
    rail?: ManualPaymentRail;
    amountIrt?: number;
  }): Promise<BankDestinationEntity[]> {
    const items = await this.destinationRepository.find({
      where: { enabled: true },
      order: { displayOrder: 'ASC', id: 'ASC' },
    });

    return items.filter((d) => {
      if (params.rail && !(d.allowedRails || []).includes(params.rail)) {
        return false;
      }
      if (
        params.amountIrt != null &&
        !this.amountWithinLimits(d, params.amountIrt)
      ) {
        return false;
      }
      if (params.rail) {
        try {
          this.assertRailCompatibility(d, params.rail);
        } catch {
          return false;
        }
      }
      return true;
    });
  }

  async listAllAdmin(): Promise<BankDestinationEntity[]> {
    return this.destinationRepository.find({
      order: { displayOrder: 'ASC', id: 'ASC' },
    });
  }

  async getById(id: number): Promise<BankDestinationEntity> {
    const dest = await this.destinationRepository.findOne({ where: { id } });
    if (!dest) {
      this.error.unprocessableEntity(['مقصد بانکی یافت نشد']);
    }
    return dest;
  }

  async create(
    dto: {
      bankName: string;
      accountHolderName: string;
      cardNumber?: string | null;
      iban?: string | null;
      accountNumber?: string | null;
      enabled?: boolean;
      allowedRails: ManualPaymentRail[];
      instructions?: string | null;
      minAmountIrt?: number | null;
      maxAmountIrt?: number | null;
      displayOrder?: number;
    },
    userId: number,
  ): Promise<{ id: number }> {
    if (!dto.allowedRails?.length) {
      this.error.unprocessableEntity(['حداقل یک روش پرداخت الزامی است']);
    }

    const cardNumber = normalizeCardNumber(dto.cardNumber);
    const iban = normalizeIban(dto.iban);
    const enabled = dto.enabled ?? true;

    this.assertAmountLimitPair(dto.minAmountIrt, dto.maxAmountIrt);
    this.assertEnabledRailsHaveIdentifiers(
      enabled,
      dto.allowedRails,
      cardNumber,
      iban,
    );

    // Soft-validate provided identifiers even when disabled (reject garbage).
    if (dto.cardNumber != null && String(dto.cardNumber).trim() !== '') {
      if (!isValidIranCardNumber(cardNumber)) {
        this.error.unprocessableEntity(['شماره کارت نامعتبر است']);
      }
    }
    if (dto.iban != null && String(dto.iban).trim() !== '') {
      if (!isValidIranSheba(iban)) {
        this.error.unprocessableEntity(['شماره شبا نامعتبر است']);
      }
    }

    const now = new Date();
    const { identifiers } = await this.destinationRepository
      .createQueryBuilder()
      .insert()
      .values({
        bankName: dto.bankName,
        accountHolderName: dto.accountHolderName,
        cardNumber,
        iban,
        accountNumber: dto.accountNumber ?? null,
        enabled,
        allowedRails: dto.allowedRails,
        displayOrder:
          dto.displayOrder ??
          (await getLastDisplayOrder(BankDestinationEntity.name)),
        instructions: dto.instructions ?? null,
        minAmountIrt: dto.minAmountIrt ?? null,
        maxAmountIrt: dto.maxAmountIrt ?? null,
        createdAt: now,
        createdBy: userId,
        updatedAt: now,
        updatedBy: userId,
      })
      .execute();

    return { id: identifiers[0].id };
  }

  async update(
    id: number,
    dto: Partial<{
      bankName: string;
      accountHolderName: string;
      cardNumber: string | null;
      iban: string | null;
      accountNumber: string | null;
      enabled: boolean;
      allowedRails: ManualPaymentRail[];
      instructions: string | null;
      minAmountIrt: number | null;
      maxAmountIrt: number | null;
      displayOrder: number;
    }>,
    userId: number,
  ): Promise<void> {
    const dest = await this.getById(id);

    const nextCard =
      dto.cardNumber !== undefined
        ? normalizeCardNumber(dto.cardNumber)
        : dest.cardNumber;
    const nextIban =
      dto.iban !== undefined ? normalizeIban(dto.iban) : dest.iban;
    const nextRails = dto.allowedRails ?? dest.allowedRails;
    const nextEnabled = dto.enabled ?? dest.enabled;
    const nextMin =
      dto.minAmountIrt !== undefined ? dto.minAmountIrt : dest.minAmountIrt;
    const nextMax =
      dto.maxAmountIrt !== undefined ? dto.maxAmountIrt : dest.maxAmountIrt;

    this.assertAmountLimitPair(nextMin, nextMax);
    this.assertEnabledRailsHaveIdentifiers(
      nextEnabled,
      nextRails,
      nextCard,
      nextIban,
    );

    if (dto.cardNumber !== undefined && dto.cardNumber != null && String(dto.cardNumber).trim() !== '') {
      if (!isValidIranCardNumber(nextCard)) {
        this.error.unprocessableEntity(['شماره کارت نامعتبر است']);
      }
    }
    if (dto.iban !== undefined && dto.iban != null && String(dto.iban).trim() !== '') {
      if (!isValidIranSheba(nextIban)) {
        this.error.unprocessableEntity(['شماره شبا نامعتبر است']);
      }
    }

    Object.assign(dest, dto, {
      cardNumber: nextCard,
      iban: nextIban,
      updatedAt: new Date(),
      updatedBy: userId,
    });
    await this.destinationRepository.save(dest);
  }

  async softDisable(id: number, userId: number): Promise<void> {
    await this.update(id, { enabled: false }, userId);
  }
}
