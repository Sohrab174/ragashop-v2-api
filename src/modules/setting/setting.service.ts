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
import {
  APPROVED_SETTINGS_BOOTSTRAP_SINGLETON,
  isSettingsBootstrapEnabled,
  SETTINGS_BOOTSTRAP_LOCK_NAME,
  SettingsBootstrapResult,
} from './settings-bootstrap.constants';

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
   * Explicit one-time settings bootstrap (NOT on startup).
   * Requires SETTINGS_BOOTSTRAP_ENABLED=true. Never overwrites existing rows.
   * Storefront is ready only after a genuine fresh TGJU persist.
   */
  async bootstrapApprovedSingleton(): Promise<SettingsBootstrapResult> {
    if (!isSettingsBootstrapEnabled()) {
      this.logger.warn(
        'Settings bootstrap skipped: SETTINGS_BOOTSTRAP_ENABLED is not true',
      );
      return {
        outcome: 'skipped_disabled',
        storefrontReady: false,
        settingId: null,
        tryToRial: null,
        message:
          'Settings bootstrap disabled. Set SETTINGS_BOOTSTRAP_ENABLED=true to allow a one-time run.',
        settingsCommitted: false,
        fxRecoveryRequired: false,
      };
    }

    try {
      return await withMysqlNamedLock(
        getConnection(),
        SETTINGS_BOOTSTRAP_LOCK_NAME,
        () => this.bootstrapApprovedSingletonLocked(),
        15,
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      this.logger.error(`Settings bootstrap failed before/during INSERT: ${detail}`);
      return {
        outcome: 'failed',
        storefrontReady: false,
        settingId: null,
        tryToRial: null,
        message:
          'Settings bootstrap failed before commit; no settings row was written by this attempt.',
        settingsCommitted: false,
        fxRecoveryRequired: false,
      };
    }
  }

  /**
   * Testable core: advisory lock held by caller (or test harness).
   * Post-commit FX failures never undo the committed settings row.
   */
  async bootstrapApprovedSingletonLocked(
    refreshFx: () => Promise<number | null> = () => this.getTryToRial(),
    readAuthoritative: () => Promise<AuthoritativeTryToToman> = () =>
      this.getAuthoritativeTryToToman(),
  ): Promise<SettingsBootstrapResult> {
    const connection = getConnection();
    const queryRunner = connection.createQueryRunner();
    let transactionStarted = false;
    let created = false;

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      transactionStarted = true;

      const existing = await queryRunner.manager.count(SettingEntity);
      if (existing > 0) {
        await queryRunner.rollbackTransaction();
        transactionStarted = false;
        this.logger.log(
          'Settings bootstrap skipped: setting table already has row(s); left unchanged',
        );
        return {
          outcome: 'skipped_existing',
          storefrontReady: false,
          settingId: null,
          tryToRial: null,
          message:
            'Settings bootstrap skipped because setting already has rows.',
          settingsCommitted: false,
          fxRecoveryRequired: true,
        };
      }

      const entity = queryRunner.manager.create(
        SettingEntity,
        APPROVED_SETTINGS_BOOTSTRAP_SINGLETON as Partial<SettingEntity>,
      );
      await queryRunner.manager.save(entity);
      await queryRunner.commitTransaction();
      transactionStarted = false;
      created = true;
      this.logger.log(
        'Settings bootstrap created setting id=1; FX still invalid until TGJU refresh',
      );
    } catch (e) {
      if (transactionStarted) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          // transaction may already be inactive
        }
        transactionStarted = false;
      }
      throw e;
    } finally {
      try {
        if (!queryRunner.isReleased) {
          await queryRunner.release();
        }
      } catch {
        // never leave a leaked runner unattempted; ignore double-release races
      }
    }

    if (!created) {
      return {
        outcome: 'failed',
        storefrontReady: false,
        settingId: null,
        tryToRial: null,
        message: 'Settings bootstrap did not create a row.',
        settingsCommitted: false,
        fxRecoveryRequired: false,
      };
    }

    return this.completeBootstrapAfterSettingsCommit(refreshFx, readAuthoritative);
  }

  /**
   * Settings INSERT already committed. FX failures must not look like INSERT rollback.
   */
  private async completeBootstrapAfterSettingsCommit(
    refreshFx: () => Promise<number | null>,
    readAuthoritative: () => Promise<AuthoritativeTryToToman>,
  ): Promise<SettingsBootstrapResult> {
    const fxPendingMessage =
      'Setting id=1 was committed successfully. FX refresh/read failed — storefront NOT ready. ' +
      'Retrying bootstrap will skip the existing row; recover FX via PUT /settings/try-to-rial (or cron).';

    let tryToRial: number | null = null;
    try {
      tryToRial = await refreshFx();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Settings bootstrap: post-commit TGJU refresh threw (${detail}); settings row kept`,
      );
      return {
        outcome: 'created',
        storefrontReady: false,
        settingId: 1,
        tryToRial: null,
        message: fxPendingMessage,
        settingsCommitted: true,
        fxRecoveryRequired: true,
      };
    }

    if (tryToRial == null || !(tryToRial > 0)) {
      this.logger.warn(
        'Settings bootstrap: TGJU refresh failed or invalid after commit; storefront NOT ready',
      );
      return {
        outcome: 'created',
        storefrontReady: false,
        settingId: 1,
        tryToRial: null,
        message: fxPendingMessage,
        settingsCommitted: true,
        fxRecoveryRequired: true,
      };
    }

    try {
      const authoritative = await readAuthoritative();
      const storefrontReady =
        authoritative.isFresh &&
        authoritative.tryToToman > 0 &&
        authoritative.tryToRialRaw > 0;

      if (!storefrontReady) {
        this.logger.warn(
          'Settings bootstrap: post-commit FX present but not fresh/valid; storefront NOT ready',
        );
        return {
          outcome: 'created',
          storefrontReady: false,
          settingId: 1,
          tryToRial,
          message: fxPendingMessage,
          settingsCommitted: true,
          fxRecoveryRequired: true,
        };
      }

      this.logger.log(
        'Settings bootstrap complete: setting id=1 and fresh TGJU FX; storefrontReady=true',
      );
      return {
        outcome: 'created',
        storefrontReady: true,
        settingId: 1,
        tryToRial,
        message: 'Setting id=1 created and fresh TGJU FX persisted.',
        settingsCommitted: true,
        fxRecoveryRequired: false,
      };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Settings bootstrap: post-commit FX rate-read threw (${detail}); settings row kept`,
      );
      return {
        outcome: 'created',
        storefrontReady: false,
        settingId: 1,
        tryToRial,
        message: fxPendingMessage,
        settingsCommitted: true,
        fxRecoveryRequired: true,
      };
    }
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
   * Fail-closed when no positive TRY→toman rate exists.
   * Used by listing, cart, and quotes. Does NOT invent a rate of 1.
   * A positive but stale last-known-good rate is still accepted here;
   * purchase uses requireFreshAuthoritativeTryToToman.
   */
  async requirePositiveAuthoritativeTryToToman(
    now: Date = new Date(),
  ): Promise<AuthoritativeTryToToman> {
    const rate = await this.getAuthoritativeTryToToman(now);
    if (!rate.tryToToman || rate.tryToToman <= 0) {
      this.error.unprocessableEntity(
        ['نرخ ارز معتبر در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.'],
        { code: 'fx_rate_unavailable' },
      );
    }
    return rate;
  }

  /**
   * Fail-closed for NEW order creation when rate missing/stale.
   */
  async requireFreshAuthoritativeTryToToman(
    now: Date = new Date(),
  ): Promise<AuthoritativeTryToToman> {
    const rate = await this.requirePositiveAuthoritativeTryToToman(now);

    if (!rate.fetchedAt || rate.ageMs == null) {
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
   * Positive TRY→toman for catalog/cart display.
   * Never falls back to 1 when the rate is missing, zero, or invalid.
   */
  async getTryToToman(): Promise<number> {
    const rate = await this.requirePositiveAuthoritativeTryToToman();
    return rate.tryToToman;
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

    console.log('FETCHED', fetched);
    if (fetched == null || !Number.isFinite(fetched) || fetched <= 0) {
      this.logger.warn('TGJU TRY rate fetch failed or invalid; keeping last-known-good');
      return null;
    }

    const now = new Date();
    // const updateResult = await this.settingRepository
    //   .createQueryBuilder()
    //   .update()
    //   .set({
    //     tryToRial: fetched,
    //     tryToRialFetchedAt: now,
    //     tryToRialSource: FX_RATE_SOURCE_TGJU,
    //   })
    //   .where({ id: 1 })
    //   .execute();
    const updateResult =await this.settingRepository.upsert(
  {
    id: 1,
    tryToRial: fetched,
    tryToRialFetchedAt: now,
    tryToRialSource: FX_RATE_SOURCE_TGJU,
  },
  ['id'],
);

    // const affected = Number(updateResult?.affected ?? 0);
    // if (affected !== 1) {
    //   this.logger.error(
    //     `TGJU TRY/IRR persist failed: affected=${affected} (expected 1); setting id=1 missing or not updated; fetched=${fetched}`,
    //   );
    //   return null;
    // }

    // this.logger.log(`TGJU TRY/IRR updated=${fetched} at=${now.toISOString()}`);
    if (!updateResult) {
  this.logger.error(
    `TGJU TRY/IRR persist failed; setting id=1; fetched=${fetched}`,
  );
  return null;
}

this.logger.log(
  `TGJU TRY/IRR persisted=${fetched} at=${now.toISOString()}`,
);
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
