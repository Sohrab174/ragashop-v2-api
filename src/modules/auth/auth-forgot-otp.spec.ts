import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import * as moment from 'jalali-moment';
import { ErrorService } from '../../error/error.service';
import {
  FIXED_DEV_OTP_CODE,
  OtpDeliveryService,
} from '../../sms/otp-delivery/otp-delivery.service';
import { AUTH_RATE_LIMIT_KEY } from '../../security/auth-rate-limit.decorator';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const FULL_SMS_CONFIG = {
  amootsmsUsername: 'fake-amoot-user',
  amootsmsPassword: 'fake-amoot-pass',
  vatansmsApiId: 'fake-vatan-id',
  vatansmsApiKey: 'fake-vatan-key',
};

function makeHarness(opts: {
  nodeEnv?: string;
  mobile?: string | null;
  amoot?: boolean;
  expireRandomHash?: Date | null;
}) {
  const user = {
    id: 1,
    mobile: opts.mobile === undefined ? '+989121234567' : opts.mobile,
    randomHash: null as string | null,
    expireRandomHash: opts.expireRandomHash ?? null,
    save: jest.fn(async () => user),
  };
  const userService = {
    findActiveUserByMobileOrEmail: jest.fn(async () => user),
    findByValidHashCode: jest.fn(async () => null),
  };
  const amootsmsService = {
    sendOTP: jest.fn(async () => opts.amoot ?? true),
  };
  const vatansmsService = { sendOTP: jest.fn(async () => true) };
  const config = { app: { nodeEnv: opts.nodeEnv }, sms: FULL_SMS_CONFIG };
  const error = new ErrorService();
  const otpDelivery = new OtpDeliveryService(
    config as any,
    error,
    amootsmsService as any,
    vatansmsService as any,
  );
  const service = new AuthService(
    userService as any,
    error,
    null,
    otpDelivery,
    config as any,
    null,
  );
  return { service, user, amootsmsService };
}

async function httpError(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof HttpException) return e;
    throw e;
  }
  throw new Error('expected HttpException');
}

beforeEach(() => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('Admin AuthService.forgotPassword OTP', () => {
  it('delivers first, then persists, and does not return the user', async () => {
    const h = makeHarness({ nodeEnv: 'production' });
    const result = await h.service.forgotPassword({
      emailOrMobile: '+989121234567',
    } as any);

    expect(result).toBe(true);
    expect(h.amootsmsService.sendOTP).toHaveBeenCalledWith(
      '+989121234567',
      '55000',
    );
    expect(h.user.randomHash).toBe('55000');
    expect(h.amootsmsService.sendOTP.mock.invocationCallOrder[0]).toBeLessThan(
      h.user.save.mock.invocationCallOrder[0],
    );
  });

  it('provider failure → 503 and no code stored', async () => {
    const h = makeHarness({ nodeEnv: 'production', amoot: false });
    const err = await httpError(
      h.service.forgotPassword({ emailOrMobile: '+989121234567' } as any),
    );
    expect(err.getStatus()).toBe(503);
    expect(h.user.save).not.toHaveBeenCalled();
    expect(h.user.randomHash).toBeNull();
  });

  it('admin without a mobile fails closed outside developer mode', async () => {
    const h = makeHarness({ nodeEnv: 'production', mobile: null });
    const err = await httpError(
      h.service.forgotPassword({ emailOrMobile: 'a@example.com' } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(h.user.save).not.toHaveBeenCalled();
  });

  it('uses the fixed code in development without contacting a provider', async () => {
    const h = makeHarness({ nodeEnv: 'development' });
    await h.service.forgotPassword({ emailOrMobile: '+989121234567' } as any);
    expect(h.user.randomHash).toBe(FIXED_DEV_OTP_CODE);
    expect(h.amootsmsService.sendOTP).not.toHaveBeenCalled();
  });

  it('never uses the fixed code in production', async () => {
    const h = makeHarness({ nodeEnv: 'production' });
    await h.service.forgotPassword({ emailOrMobile: '+989121234567' } as any);
    expect(h.user.randomHash).not.toBe(FIXED_DEV_OTP_CODE);
  });

  it('keeps the resend window', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      expireRandomHash: moment().add(3, 'minutes').toDate(),
    });
    const err = await httpError(
      h.service.forgotPassword({ emailOrMobile: '+989121234567' } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(h.amootsmsService.sendOTP).not.toHaveBeenCalled();
  });

  it('keeps the otpSend rate limit on the controller', () => {
    expect(
      Reflect.getMetadata(
        AUTH_RATE_LIMIT_KEY,
        AuthController.prototype.forgotPassword,
      ),
    ).toEqual(expect.objectContaining({ kind: 'otpSend' }));
  });
});
