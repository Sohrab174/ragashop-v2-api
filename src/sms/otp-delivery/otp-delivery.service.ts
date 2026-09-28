import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration.service';
import { ErrorService } from '../../error/error.service';
import { isFixedDevOtpAllowed } from '../../security/security-config.util';
import { AmootsmsService } from '../amootsms/amootsms.service';
import { VatansmsService } from '../vatansms/vatansms.service';

export const FIXED_DEV_OTP_CODE = '11111';

export const OTP_DELIVERY_UNAVAILABLE_MESSAGE =
  'ارسال پیامک در حال حاضر ممکن نیست. لطفاً چند دقیقه دیگر دوباره تلاش کنید.';
export const OTP_UNSUPPORTED_DESTINATION_MESSAGE =
  'ارسال پیامک به این شماره پشتیبانی نمی‌شود.';

export type OtpProvider = 'amootsms' | 'vatansms';

export type OtpDeliveryFailureReason =
  | 'unsupported_destination'
  | 'provider_not_configured'
  | 'provider_failed';

export type OtpDeliveryResult =
  | { ok: true; mode: 'provider' | 'fixed_dev' }
  | { ok: false; reason: OtpDeliveryFailureReason };

/** +98 → AmootSMS, +90 → VatanSMS; anything else has no provider. */
export function resolveOtpProvider(
  mobile: string | null | undefined,
): OtpProvider | null {
  if (typeof mobile !== 'string') {
    return null;
  }
  if (mobile.startsWith('+98')) {
    return 'amootsms';
  }
  if (mobile.startsWith('+90')) {
    return 'vatansms';
  }
  return null;
}

function hasValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

@Injectable()
export class OtpDeliveryService {
  constructor(
    private config: ConfigurationService,
    private error: ErrorService,
    private amootsmsService: AmootsmsService,
    private vatansmsService: VatansmsService,
  ) {}

  isFixedDevOtpMode(): boolean {
    return isFixedDevOtpAllowed({
      NODE_ENV: this.config.app?.nodeEnv,
    } as NodeJS.ProcessEnv);
  }

  async issueCode(generateRandomCode: () => Promise<string>): Promise<string> {
    return this.isFixedDevOtpMode()
      ? FIXED_DEV_OTP_CODE
      : await generateRandomCode();
  }

  isProviderConfigured(provider: OtpProvider): boolean {
    const sms = this.config.sms || ({} as ConfigurationService['sms']);
    if (provider === 'amootsms') {
      return hasValue(sms.amootsmsUsername) && hasValue(sms.amootsmsPassword);
    }
    return hasValue(sms.vatansmsApiId) && hasValue(sms.vatansmsApiKey);
  }

  /**
   * Succeeds only when a supported, configured provider confirms the send.
   * Fixed developer mode never contacts a provider.
   */
  async deliver(
    mobile: string | null | undefined,
    code: string,
  ): Promise<OtpDeliveryResult> {
    if (this.isFixedDevOtpMode()) {
      return { ok: true, mode: 'fixed_dev' };
    }

    const provider = resolveOtpProvider(mobile);
    if (!provider) {
      return { ok: false, reason: 'unsupported_destination' };
    }

    if (!this.isProviderConfigured(provider)) {
      console.error('OTP provider is not configured', { provider });
      return { ok: false, reason: 'provider_not_configured' };
    }

    let sent = false;
    try {
      sent =
        provider === 'amootsms'
          ? await this.amootsmsService.sendOTP(mobile, code)
          : await this.vatansmsService.sendOTP(mobile, code);
    } catch {
      sent = false;
    }

    return sent === true
      ? { ok: true, mode: 'provider' }
      : { ok: false, reason: 'provider_failed' };
  }

  /** Throws a customer-safe error unless the code was actually delivered. */
  async deliverOrThrow(
    mobile: string | null | undefined,
    code: string,
  ): Promise<void> {
    const result = await this.deliver(mobile, code);
    if (result.ok === true) {
      return;
    }
    if (result.reason === 'unsupported_destination') {
      this.error.unprocessableEntity([OTP_UNSUPPORTED_DESTINATION_MESSAGE], {
        code: 'otp_unsupported_destination',
      });
    }
    this.error.serviceUnavailable([OTP_DELIVERY_UNAVAILABLE_MESSAGE], {
      code: 'otp_delivery_failed',
    });
  }
}
