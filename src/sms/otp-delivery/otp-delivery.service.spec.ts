import { HttpException } from '@nestjs/common';
import { ErrorService } from '../../error/error.service';
import {
  FIXED_DEV_OTP_CODE,
  OTP_DELIVERY_UNAVAILABLE_MESSAGE,
  OTP_UNSUPPORTED_DESTINATION_MESSAGE,
  OtpDeliveryService,
  resolveOtpProvider,
} from './otp-delivery.service';

type SmsConfig = {
  amootsmsUsername?: string;
  amootsmsPassword?: string;
  vatansmsApiId?: string;
  vatansmsApiKey?: string;
};

const FULL_SMS_CONFIG: SmsConfig = {
  amootsmsUsername: 'fake-amoot-user',
  amootsmsPassword: 'fake-amoot-pass',
  vatansmsApiId: 'fake-vatan-id',
  vatansmsApiKey: 'fake-vatan-key',
};

function makeService(
  nodeEnv: string | undefined,
  sms: SmsConfig = FULL_SMS_CONFIG,
  amootResult: boolean | Error = true,
  vatanResult: boolean | Error = true,
) {
  const amootsmsService = {
    sendOTP: jest.fn(async () => {
      if (amootResult instanceof Error) throw amootResult;
      return amootResult;
    }),
  };
  const vatansmsService = {
    sendOTP: jest.fn(async () => {
      if (vatanResult instanceof Error) throw vatanResult;
      return vatanResult;
    }),
  };
  const config = { app: { nodeEnv }, sms };
  const service = new OtpDeliveryService(
    config as any,
    new ErrorService(),
    amootsmsService as any,
    vatansmsService as any,
  );
  return { service, amootsmsService, vatansmsService };
}

async function captureHttpError(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('expected an HttpException');
}

describe('resolveOtpProvider', () => {
  it('routes +98 to AmootSMS and +90 to VatanSMS', () => {
    expect(resolveOtpProvider('+989121234567')).toBe('amootsms');
    expect(resolveOtpProvider('+905321234567')).toBe('vatansms');
  });

  it.each([
    '+14155550100',
    '+447700900123',
    '',
    '09121234567',
    null,
    undefined,
  ])('has no provider for %j', (mobile) => {
    expect(resolveOtpProvider(mobile as string)).toBeNull();
  });
});

describe('OtpDeliveryService environment gate', () => {
  it.each(['development', 'local', 'test'])(
    'issues the fixed code and skips providers in %s',
    async (nodeEnv) => {
      const { service, amootsmsService, vatansmsService } =
        makeService(nodeEnv);
      const generate = jest.fn(async () => '54321');
      expect(await service.issueCode(generate)).toBe(FIXED_DEV_OTP_CODE);
      expect(generate).not.toHaveBeenCalled();
      expect(
        await service.deliver('+989121234567', FIXED_DEV_OTP_CODE),
      ).toEqual({ ok: true, mode: 'fixed_dev' });
      expect(amootsmsService.sendOTP).not.toHaveBeenCalled();
      expect(vatansmsService.sendOTP).not.toHaveBeenCalled();
    },
  );

  it.each([
    'production',
    'Production',
    ' production',
    'staging',
    'preview',
    '',
    undefined,
    'Development',
  ])('never issues the fixed code for NODE_ENV=%j', async (nodeEnv) => {
    const { service } = makeService(nodeEnv);
    const generate = jest.fn(async () => '54321');
    expect(await service.issueCode(generate)).toBe('54321');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(service.isFixedDevOtpMode()).toBe(false);
  });
});

describe('OtpDeliveryService.deliver outside developer mode', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('succeeds only when AmootSMS confirms the send', async () => {
    const { service, amootsmsService, vatansmsService } =
      makeService('production');
    expect(await service.deliver('+989121234567', '54321')).toEqual({
      ok: true,
      mode: 'provider',
    });
    expect(amootsmsService.sendOTP).toHaveBeenCalledWith(
      '+989121234567',
      '54321',
    );
    expect(vatansmsService.sendOTP).not.toHaveBeenCalled();
  });

  it('succeeds only when VatanSMS confirms the send', async () => {
    const { service, amootsmsService, vatansmsService } =
      makeService('production');
    expect(await service.deliver('+905321234567', '54321')).toEqual({
      ok: true,
      mode: 'provider',
    });
    expect(vatansmsService.sendOTP).toHaveBeenCalledWith(
      '+905321234567',
      '54321',
    );
    expect(amootsmsService.sendOTP).not.toHaveBeenCalled();
  });

  it('fails when the provider reports a rejected send', async () => {
    const { service } = makeService('production', FULL_SMS_CONFIG, false);
    expect(await service.deliver('+989121234567', '54321')).toEqual({
      ok: false,
      reason: 'provider_failed',
    });
  });

  it('fails when the provider throws', async () => {
    const { service } = makeService(
      'production',
      FULL_SMS_CONFIG,
      true,
      new Error('network down'),
    );
    expect(await service.deliver('+905321234567', '54321')).toEqual({
      ok: false,
      reason: 'provider_failed',
    });
  });

  it.each([
    ['username missing', { ...FULL_SMS_CONFIG, amootsmsUsername: undefined }],
    ['password blank', { ...FULL_SMS_CONFIG, amootsmsPassword: '   ' }],
  ])(
    'fails without calling AmootSMS when config is incomplete (%s)',
    async (_label, sms) => {
      const { service, amootsmsService } = makeService('production', sms);
      expect(await service.deliver('+989121234567', '54321')).toEqual({
        ok: false,
        reason: 'provider_not_configured',
      });
      expect(amootsmsService.sendOTP).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['api id missing', { ...FULL_SMS_CONFIG, vatansmsApiId: '' }],
    ['api key missing', { ...FULL_SMS_CONFIG, vatansmsApiKey: undefined }],
  ])(
    'fails without calling VatanSMS when config is incomplete (%s)',
    async (_label, sms) => {
      const { service, vatansmsService } = makeService('production', sms);
      expect(await service.deliver('+905321234567', '54321')).toEqual({
        ok: false,
        reason: 'provider_not_configured',
      });
      expect(vatansmsService.sendOTP).not.toHaveBeenCalled();
    },
  );

  it('fails for an unsupported country without calling any provider', async () => {
    const { service, amootsmsService, vatansmsService } =
      makeService('production');
    expect(await service.deliver('+14155550100', '54321')).toEqual({
      ok: false,
      reason: 'unsupported_destination',
    });
    expect(amootsmsService.sendOTP).not.toHaveBeenCalled();
    expect(vatansmsService.sendOTP).not.toHaveBeenCalled();
  });

  it('does not log credentials when config is missing', async () => {
    const spy = console.error as unknown as jest.SpyInstance;
    const { service } = makeService('production', {
      ...FULL_SMS_CONFIG,
      amootsmsPassword: '',
    });
    await service.deliver('+989121234567', '54321');
    expect(spy).toHaveBeenCalled();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain('fake-amoot-user');
    expect(logged).not.toContain('54321');
    expect(logged).not.toContain('+989121234567');
  });
});

describe('OtpDeliveryService.deliverOrThrow', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns quietly when the send is confirmed', async () => {
    const { service } = makeService('production');
    await expect(
      service.deliverOrThrow('+989121234567', '54321'),
    ).resolves.toBeUndefined();
  });

  it('throws a safe 503 without provider detail on provider failure', async () => {
    const { service } = makeService('production', FULL_SMS_CONFIG, false);
    const err = await captureHttpError(() =>
      service.deliverOrThrow('+989121234567', '54321'),
    );
    expect(err.getStatus()).toBe(503);
    const body = err.getResponse() as any;
    expect(body.messages).toEqual([OTP_DELIVERY_UNAVAILABLE_MESSAGE]);
    expect(body.data).toEqual({ code: 'otp_delivery_failed' });
    expect(JSON.stringify(body)).not.toMatch(/fake-|54321|amoot|vatan/i);
  });

  it('throws a safe 503 when the provider is not configured', async () => {
    const { service } = makeService('production', {});
    const err = await captureHttpError(() =>
      service.deliverOrThrow('+905321234567', '54321'),
    );
    expect(err.getStatus()).toBe(503);
    expect((err.getResponse() as any).data).toEqual({
      code: 'otp_delivery_failed',
    });
  });

  it('throws a 422 for an unsupported destination', async () => {
    const { service } = makeService('production');
    const err = await captureHttpError(() =>
      service.deliverOrThrow('+14155550100', '54321'),
    );
    expect(err.getStatus()).toBe(422);
    const body = err.getResponse() as any;
    expect(body.messages).toEqual([OTP_UNSUPPORTED_DESTINATION_MESSAGE]);
    expect(body.data).toEqual({ code: 'otp_unsupported_destination' });
  });

  it('delivery messages avoid storefront OTP/phone classifier keywords', () => {
    for (const message of [
      OTP_DELIVERY_UNAVAILABLE_MESSAGE,
      OTP_UNSUPPORTED_DESTINATION_MESSAGE,
    ]) {
      expect(message).not.toMatch(/منقضی|کد تایید|نامعتبر|موبایل|ارسال شد/);
    }
  });
});
