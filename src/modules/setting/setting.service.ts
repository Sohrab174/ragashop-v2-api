import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { getConnection, Repository } from 'typeorm';
import axios from 'axios';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { SettingEntity } from './entities/setting.entity';
import { retryOperation } from '../../utils';
import { withMysqlNamedLock } from '../../utils/named-lock.util';
import { ErrorService } from '../../error/error.service';
import {
  DEFAULT_FX_RATE_MAX_AGE_MS,
  FX_RATE_SOURCE_TGJU,
} from '../finance/finance.types';

export type AuthoritativeTryToToman = {
  /** Effective Toman per 1 TRY after markup (pricing / Order snapshot). */
  tryToToman: number;
  /** Raw TGJU TRY/Rial last-known-good. */
  tryToRialRaw: number;
  /** TRY/Rial after changePercentTryToRial. */
  tryToRialEffective: number;
  source: string;
  fetchedAt: Date | null;
  ageMs: number | null;
  isFresh: boolean;
  maxAgeMs: number;
};

@Injectable()
export class SettingService {
  private readonly logger = new Logger(SettingService.name);

  constructor(
    @InjectRepository(SettingEntity)
    private settingRepository: Repository<SettingEntity>,
    private error: ErrorService,
  ) {}

  getFxRateMaxAgeMs(): number {
    const raw = process.env.FX_RATE_MAX_AGE_MS;
    if (raw == null || raw === '') {
      return DEFAULT_FX_RATE_MAX_AGE_MS;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      return DEFAULT_FX_RATE_MAX_AGE_MS;
    }
    return Math.floor(n);
  }

  /**
   * -------------------------------------------------------
   * Get /settings/admin
   */
  async getByAdmin(select = null) {
    const setting = await this.settingRepository.findOne({
      where: { id: 1 },
      ...(select && select),
    });

    const serializedSettings: any = {
      ...setting,
      ...(setting.changePercentTryToRial != 0 && {
        tryToRial:
          setting.tryToRial +
          (setting.tryToRial * setting.changePercentTryToRial) / 100,
      }),
    };

    serializedSettings.tryToToman = Math.round(
      serializedSettings.tryToRial / 10,
    );
    serializedSettings.baseTryToToman = Math.round(setting.tryToRial / 10);

    return serializedSettings;
  }

  /**
   * -------------------------------------------------------
   * Get /settings
   */
  async get() {
    const setting = await this.settingRepository.findOne({
      where: { id: 1 },
      select: [
        'phone',
        'email',
        'address',
        'location',
        'instagram',
        'linkedin',
        'telegram',
        'twitter',
        'facebook',
        'whatsapp',
        'maxShippingCost',
        'shippingPercent',
        'taxPercent',
        'noticeBeforeOrdering',
        'minDeliveryDay',
        'maxDeliveryDay',
        'tryToRial',
        'changePercentTryToRial',
        'tryToRialFetchedAt',
        'tryToRialSource',
        'onlineGatewayPaymentsEnabled',
        'walletSpendEnabled',
      ],
    });

    const serializedSettings: any = {
      ...setting,
      ...(setting.changePercentTryToRial != 0 && {
        tryToRial:
          setting.tryToRial +
          (setting.tryToRial * setting.changePercentTryToRial) / 100,
      }),
    };

    delete serializedSettings.changePercentTryToRial;
    serializedSettings.tryToToman = Math.round(
      serializedSettings.tryToRial / 10,
    );

    return serializedSettings;
  }

  /**
   * -------------------------------------------------------
   * PUT /settings/admin
   */
  async update(dto: UpdateSettingDto) {
    return await this.settingRepository
      .createQueryBuilder()
      .update()
      .set(dto)
      .where({ id: 1 })
      .execute();
  }

  /**
   * Authoritative live TRY→Toman for pricing NEW orders / catalog display.
   * Does not mutate; uses last-known-good tryToRial + markup.
   */
  async getAuthoritativeTryToToman(
    now: Date = new Date(),
  ): Promise<AuthoritativeTryToToman> {
    const setting = await this.settingRepository.findOne({
      where: { id: 1 },
      select: [
        'id',
        'tryToRial',
        'changePercentTryToRial',
        'tryToRialFetchedAt',
        'tryToRialSource',
      ],
    });

    const maxAgeMs = this.getFxRateMaxAgeMs();
    const raw = Number(setting?.tryToRial);
    const markup = Number(setting?.changePercentTryToRial) || 0;
    const fetchedAt = setting?.tryToRialFetchedAt
      ? new Date(setting.tryToRialFetchedAt)
      : null;

    const tryToRialEffective =
      markup !== 0 ? raw + (raw * markup) / 100 : raw;
    const tryToToman = Math.round(tryToRialEffective / 10);

    const ageMs =
      fetchedAt && Number.isFinite(fetchedAt.getTime())
        ? Math.max(0, now.getTime() - fetchedAt.getTime())
        : null;

    const hasValidRate =
      Number.isFinite(raw) &&
      raw > 0 &&
      Number.isFinite(tryToToman) &&
      tryToToman > 0;

    const isFresh =
      hasValidRate &&
      ageMs != null &&
      ageMs <= maxAgeMs;

    return {
      tryToToman: hasValidRate ? tryToToman : 0,
      tryToRialRaw: hasValidRate ? raw : 0,
      tryToRialEffective: hasValidRate ? tryToRialEffective : 0,
      source: setting?.tryToRialSource || FX_RATE_SOURCE_TGJU,
      fetchedAt,
      ageMs,
      isFresh,
      maxAgeMs,
    };
  }

  /**
   * Fail-closed for NEW order creation when rate missing/stale.
   */
  async requireFreshAuthoritativeTryToToman(
    now: Date = new Date(),
  ): Promise<AuthoritativeTryToToman> {
    const rate = await this.getAuthoritativeTryToToman(now);

    if (
      !rate.tryToToman ||
      rate.tryToToman <= 0 ||
      !rate.fetchedAt ||
      rate.ageMs == null
    ) {
      this.error.unprocessableEntity(
        ['نرخ ارز معتبر در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.'],
        { code: 'fx_rate_unavailable' },
      );
    }

    if (!rate.isFresh) {
      this.error.unprocessableEntity(
        ['نرخ ارز منقضی شده است. لطفاً کمی بعد دوباره تلاش کنید.'],
        { code: 'fx_rate_stale' },
      );
    }

    return rate;
  }

  /**
   * Legacy display helper — prefer getAuthoritativeTryToToman for F1 paths.
   */
  async getTryToToman() {
    const rate = await this.getAuthoritativeTryToToman();
    return rate.tryToToman > 0 ? rate.tryToToman : 1;
  }

  /**
   * Fetch TGJU and update last-known-good only on validated success.
   * Concurrent refreshes serialize via named lock.
   */
  async getTryToRial(): Promise<number | null> {
    return withMysqlNamedLock(
      getConnection(),
      'ragashop_fx_tgju_refresh',
      async () => this.fetchAndPersistTgjuTryToRial(),
      15,
    );
  }

  /**
   * Testable core without lock (tests call this with mocks).
   */
  async fetchAndPersistTgjuTryToRial(
    fetchFn: () => Promise<number | null> = () => this.fetchTgjuTryToRialRaw(),
  ): Promise<number | null> {
    const fetched = await fetchFn();

    if (fetched == null || !Number.isFinite(fetched) || fetched <= 0) {
      this.logger.warn('TGJU TRY rate fetch failed or invalid; keeping last-known-good');
      return null;
    }

    const now = new Date();
    await this.settingRepository
      .createQueryBuilder()
      .update()
      .set({
        tryToRial: fetched,
        tryToRialFetchedAt: now,
        tryToRialSource: FX_RATE_SOURCE_TGJU,
      })
      .where({ id: 1 })
      .execute();

    this.logger.log(`TGJU TRY/IRR updated=${fetched} at=${now.toISOString()}`);
    return fetched;
  }

  private async fetchTgjuTryToRialRaw(): Promise<number | null> {
    const res = await retryOperation(
      async () => {
        try {
          const { data } = await axios.get('https://call1.tgju.org/ajax.json');
          const parsed = +(data?.current?.price_try?.p || '').replace(/\,/g, '');
          if (!Number.isFinite(parsed) || parsed <= 0) {
            return null;
          }
          return parsed;
        } catch (e) {
          return null;
        }
      },
      3,
      0,
      5000,
    );

    return res?.result ?? null;
  }
}
