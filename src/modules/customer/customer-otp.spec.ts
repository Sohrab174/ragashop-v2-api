import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import * as moment from 'jalali-moment';
import { ErrorService } from '../../error/error.service';
import {
  FIXED_DEV_OTP_CODE,
  OtpDeliveryService,
} from '../../sms/otp-delivery/otp-delivery.service';
import { normalizeCustomerMobile } from '../../utils/mobile-normalization';
import { AUTH_RATE_LIMIT_KEY } from '../../security/auth-rate-limit.decorator';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { CustomerEntity, CustomerStatus } from './entities/customer.entity';

const IR_MOBILE = '+989121234567';
const TR_MOBILE = '+905321234567';
const US_MOBILE = '+14155550100';
const DETERMINISTIC_RANDOM_CODE = '55000';

const FULL_SMS_CONFIG = {
  amootsmsUsername: 'fake-amoot-user',
  amootsmsPassword: 'fake-amoot-pass',
  vatansmsApiId: 'fake-vatan-id',
  vatansmsApiKey: 'fake-vatan-key',
};

type Row = CustomerEntity & { save: jest.Mock };

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object') {
      return true;
    }
    return row[key] === value;
  });
}

function makeHarness(opts: {
  nodeEnv?: string;
  sms?: Partial<typeof FULL_SMS_CONFIG>;
  amoot?: boolean | Error;
  vatan?: boolean | Error;
  rows?: Partial<CustomerEntity>[];
}) {
  const rows: Row[] = [];
  let nextId = 100;

  const attachSave = (row: CustomerEntity): Row => {
    const r = row as Row;
    r.save = jest.fn(async () => {
      if (!rows.includes(r)) {
        if (!r.id) r.id = nextId++;
        rows.push(r);
      }
      return r;
    });
    return r;
  };

  jest
    .spyOn(CustomerEntity.prototype, 'save')
    .mockImplementation(async function (this: CustomerEntity) {
      if (!rows.includes(this as Row)) {
        if (!this.id) this.id = nextId++;
        rows.push(this as Row);
      }
      return this;
    });

  for (const seed of opts.rows || []) {
    const row = Object.assign(new CustomerEntity(), {
      isDeleted: false,
      addresses: [],
      ...seed,
    });
    rows.push(attachSave(row));
  }

  const inserted: CustomerEntity[] = [];
  const queryBuilder: any = {
    insert: () => queryBuilder,
    values: (value: CustomerEntity) => {
      queryBuilder._values = value;
      return queryBuilder;
    },
    execute: async () => {
      const row = attachSave(
        Object.assign(new CustomerEntity(), queryBuilder._values, {
          id: nextId++,
          isDeleted: false,
          addresses: [],
        }),
      );
      rows.push(row);
      inserted.push(row);
      return { identifiers: [{ id: row.id }] };
    },
    where: () => queryBuilder,
    andWhere: () => queryBuilder,
    orderBy: () => queryBuilder,
    take: () => queryBuilder,
    skip: () => queryBuilder,
    getOne: async () => rows[0],
    getManyAndCount: async () => [rows, rows.length],
  };

  const repository = {
    find: jest.fn(async ({ where }) =>
      rows.filter((r) => matches(r as any, where)),
    ),
    findOne: jest.fn(async (arg: any) => {
      const where = arg && 'where' in arg ? arg.where : arg;
      return rows.find((r) => matches(r as any, where));
    }),
    update: jest.fn(async ({ id }, patch) => {
      const row = rows.find((r) => r.id === id);
      Object.assign(row, patch);
      return { affected: row ? 1 : 0 };
    }),
    createQueryBuilder: () => queryBuilder,
  };

  const amootsmsService = {
    sendOTP: jest.fn(async () => {
      const r = opts.amoot ?? true;
      if (r instanceof Error) throw r;
      return r;
    }),
  };
  const vatansmsService = {
    sendOTP: jest.fn(async () => {
      const r = opts.vatan ?? true;
      if (r instanceof Error) throw r;
      return r;
    }),
  };

  const config = {
    app: { nodeEnv: opts.nodeEnv },
    auth: { expires: '1h', expiresLifetime: '30d' },
    sms: opts.sms ?? FULL_SMS_CONFIG,
  };
  const error = new ErrorService();
  const otpDelivery = new OtpDeliveryService(
    config as any,
    error,
    amootsmsService as any,
    vatansmsService as any,
  );
  const identity = {
    normalizeMobile: normalizeCustomerMobile,
    withNormalizedMobileLock: jest.fn(async (_m: string, fn: () => unknown) =>
      fn(),
    ),
  };

  const service = new CustomerService(
    repository as any,
    null,
    config as any,
    { sign: jest.fn(() => 'fake-token') } as any,
    error,
    null,
    otpDelivery,
    null,
    null,
    identity as any,
  );

  return {
    service,
    rows,
    inserted,
    repository,
    amootsmsService,
    vatansmsService,
    identity,
  };
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Customer OTP — fixed developer code environment matrix', () => {
  it.each(['development', 'local', 'test'])(
    'stores 11111 without contacting any provider in %s',
    async (nodeEnv) => {
      const h = makeHarness({ nodeEnv });
      await h.service.loginByMobile({ mobile: IR_MOBILE } as any);

      expect(h.rows).toHaveLength(1);
      expect(h.rows[0].randomHash).toBe(FIXED_DEV_OTP_CODE);
      expect(h.amootsmsService.sendOTP).not.toHaveBeenCalled();
      expect(h.vatansmsService.sendOTP).not.toHaveBeenCalled();
    },
  );

  it.each([
    'production',
    'Production',
    ' production ',
    'staging',
    'preview',
    '',
    undefined,
    'Development',
  ])('never stores 11111 for NODE_ENV=%j', async (nodeEnv) => {
    const h = makeHarness({ nodeEnv });
    await h.service.loginByMobile({ mobile: IR_MOBILE } as any);

    expect(h.rows[0].randomHash).toBe(DETERMINISTIC_RANDOM_CODE);
    expect(h.rows[0].randomHash).not.toBe(FIXED_DEV_OTP_CODE);
    expect(h.amootsmsService.sendOTP).toHaveBeenCalledWith(
      IR_MOBILE,
      DETERMINISTIC_RANDOM_CODE,
    );
  });
});

describe('Customer OTP — loginByMobile send-then-persist', () => {
  it('persists the delivered code only after AmootSMS confirms', async () => {
    const h = makeHarness({ nodeEnv: 'production' });
    const res = await h.service.loginByMobile({ mobile: IR_MOBILE } as any);

    expect(res).toEqual({ mobile: IR_MOBILE, isNewUser: true });
    expect(h.rows[0].randomHash).toBe(DETERMINISTIC_RANDOM_CODE);
    expect(
      moment(h.rows[0].expireRandomHash).diff(moment(), 'seconds'),
    ).toBeGreaterThan(290);
    const sendOrder = h.amootsmsService.sendOTP.mock.invocationCallOrder[0];
    const saveOrder = h.rows[0].save.mock.invocationCallOrder[0];
    expect(sendOrder).toBeLessThan(saveOrder);
  });

  it('delivers +90 numbers through VatanSMS', async () => {
    const h = makeHarness({ nodeEnv: 'production' });
    await h.service.loginByMobile({ mobile: TR_MOBILE } as any);
    expect(h.vatansmsService.sendOTP).toHaveBeenCalledWith(
      TR_MOBILE,
      DETERMINISTIC_RANDOM_CODE,
    );
    expect(h.amootsmsService.sendOTP).not.toHaveBeenCalled();
  });

  it.each([
    ['rejected', false],
    ['threw', new Error('provider down')],
  ])(
    'provider %s → 503, no new customer and no usable code',
    async (_label, amoot) => {
      const h = makeHarness({ nodeEnv: 'production', amoot });
      const err = await httpError(
        h.service.loginByMobile({ mobile: IR_MOBILE } as any),
      );

      expect(err.getStatus()).toBe(503);
      expect((err.getResponse() as any).data).toEqual({
        code: 'otp_delivery_failed',
      });
      expect(h.rows).toHaveLength(0);

      const verifyErr = await httpError(
        h.service.verifyLogin({
          mobile: IR_MOBILE,
          code: DETERMINISTIC_RANDOM_CODE,
          firstName: 'a',
          lastName: 'b',
        } as any),
      );
      expect(verifyErr.getStatus()).toBe(422);
    },
  );

  it('provider failure leaves an existing customer without a usable code', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      amoot: false,
      rows: [
        {
          id: 1,
          mobile: IR_MOBILE,
          status: CustomerStatus.active,
          firstName: 'A',
          lastName: 'B',
          randomHash: null,
          expireRandomHash: null,
        },
      ],
    });
    await httpError(h.service.loginByMobile({ mobile: IR_MOBILE } as any));

    expect(h.rows[0].randomHash).toBeNull();
    expect(h.rows[0].save).not.toHaveBeenCalled();
    const verifyErr = await httpError(
      h.service.verifyLogin({
        mobile: IR_MOBILE,
        code: DETERMINISTIC_RANDOM_CODE,
      } as any),
    );
    expect(verifyErr.getStatus()).toBe(422);
  });

  it('provider failure does not replace a previously delivered, still-valid code', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      amoot: false,
      rows: [
        {
          id: 1,
          mobile: IR_MOBILE,
          status: CustomerStatus.active,
          firstName: 'A',
          lastName: 'B',
          randomHash: '22222',
          expireRandomHash: moment().add(1, 'minute').toDate(),
        },
      ],
    });
    await httpError(h.service.loginByMobile({ mobile: IR_MOBILE } as any));
    expect(h.rows[0].randomHash).toBe('22222');
  });

  it('missing AmootSMS config → 503 without contacting the provider', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      sms: { ...FULL_SMS_CONFIG, amootsmsPassword: '' },
    });
    const err = await httpError(
      h.service.loginByMobile({ mobile: IR_MOBILE } as any),
    );
    expect(err.getStatus()).toBe(503);
    expect(h.amootsmsService.sendOTP).not.toHaveBeenCalled();
    expect(h.rows).toHaveLength(0);
  });

  it('missing VatanSMS config → 503 without contacting the provider', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      sms: { ...FULL_SMS_CONFIG, vatansmsApiKey: undefined },
    });
    const err = await httpError(
      h.service.loginByMobile({ mobile: TR_MOBILE } as any),
    );
    expect(err.getStatus()).toBe(503);
    expect(h.vatansmsService.sendOTP).not.toHaveBeenCalled();
    expect(h.rows).toHaveLength(0);
  });

  it('unsupported country → 422 and nothing persisted', async () => {
    const h = makeHarness({ nodeEnv: 'production' });
    const err = await httpError(
      h.service.loginByMobile({ mobile: US_MOBILE } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect((err.getResponse() as any).data).toEqual({
      code: 'otp_unsupported_destination',
    });
    expect(h.amootsmsService.sendOTP).not.toHaveBeenCalled();
    expect(h.vatansmsService.sendOTP).not.toHaveBeenCalled();
    expect(h.rows).toHaveLength(0);
  });

  it('failure responses never leak credentials or the code', async () => {
    const h = makeHarness({ nodeEnv: 'production', amoot: false });
    const err = await httpError(
      h.service.loginByMobile({ mobile: IR_MOBILE } as any),
    );
    const serialized = JSON.stringify(err.getResponse());
    expect(serialized).not.toContain('fake-amoot');
    expect(serialized).not.toContain(DETERMINISTIC_RANDOM_CODE);
  });

  it('keeps the provider call outside the mobile lock', async () => {
    const h = makeHarness({ nodeEnv: 'production' });
    let insideLock = false;
    let sentInsideLock = false;
    h.identity.withNormalizedMobileLock.mockImplementation(
      async (_m: string, fn: () => unknown) => {
        insideLock = true;
        try {
          return await fn();
        } finally {
          insideLock = false;
        }
      },
    );
    h.amootsmsService.sendOTP.mockImplementation(async () => {
      sentInsideLock = insideLock;
      return true;
    });
    await h.service.loginByMobile({ mobile: IR_MOBILE } as any);
    expect(sentInsideLock).toBe(false);
  });
});

describe('Customer OTP — resend window and verify semantics', () => {
  function seededActive(overrides: Partial<CustomerEntity> = {}) {
    return {
      id: 1,
      mobile: IR_MOBILE,
      status: CustomerStatus.active,
      firstName: 'A',
      lastName: 'B',
      randomHash: null,
      expireRandomHash: null,
      ...overrides,
    };
  }

  it('loginByMobile reuses a fresh code without sending again', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      rows: [
        seededActive({
          randomHash: '33333',
          expireRandomHash: moment().add(4, 'minutes').toDate(),
        }),
      ],
    });
    const res = await h.service.loginByMobile({ mobile: IR_MOBILE } as any);
    expect(res).toEqual({ mobile: IR_MOBILE, isNewUser: false });
    expect(h.amootsmsService.sendOTP).not.toHaveBeenCalled();
    expect(h.rows[0].randomHash).toBe('33333');
  });

  it('loginByMobile sends a new code once the reuse window has passed', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      rows: [
        seededActive({
          randomHash: '33333',
          expireRandomHash: moment().add(1, 'minute').toDate(),
        }),
      ],
    });
    await h.service.loginByMobile({ mobile: IR_MOBILE } as any);
    expect(h.amootsmsService.sendOTP).toHaveBeenCalledTimes(1);
    expect(h.rows[0].randomHash).toBe(DETERMINISTIC_RANDOM_CODE);
  });

  it('sendOtpCode refuses to resend inside the window', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      rows: [
        seededActive({
          status: CustomerStatus.inactive,
          randomHash: '33333',
          expireRandomHash: moment().add(4, 'minutes').toDate(),
        }),
      ],
    });
    const err = await httpError(
      h.service.sendOtpCode({ mobile: IR_MOBILE, type: 'signup' } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(h.amootsmsService.sendOTP).not.toHaveBeenCalled();
  });

  it('rejects an expired code', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      rows: [
        seededActive({
          randomHash: '44444',
          expireRandomHash: moment().subtract(1, 'second').toDate(),
        }),
      ],
    });
    const err = await httpError(
      h.service.verifyLogin({ mobile: IR_MOBILE, code: '44444' } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(h.rows[0].save).not.toHaveBeenCalled();
  });

  it('rejects an incorrect code', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      rows: [
        seededActive({
          randomHash: '44444',
          expireRandomHash: moment().add(4, 'minutes').toDate(),
        }),
      ],
    });
    const err = await httpError(
      h.service.verifyLogin({ mobile: IR_MOBILE, code: '44445' } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(h.rows[0].randomHash).toBe('44444');
  });

  it('accepts the correct code once and clears it', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      rows: [
        seededActive({
          randomHash: '44444',
          expireRandomHash: moment().add(4, 'minutes').toDate(),
        }),
      ],
    });
    const res: any = await h.service.verifyLogin({
      mobile: IR_MOBILE,
      code: '44444',
    } as any);
    expect(res.accessToken).toBe('fake-token');
    expect(h.rows[0].randomHash).toBeNull();
    expect(h.rows[0].expireRandomHash).toBeNull();

    const replay = await httpError(
      h.service.verifyLogin({ mobile: IR_MOBILE, code: '44444' } as any),
    );
    expect(replay.getStatus()).toBe(422);
  });
});

describe('Customer OTP — banned customers cannot bypass', () => {
  function bannedRow(overrides: Partial<CustomerEntity> = {}) {
    return {
      id: 7,
      mobile: IR_MOBILE,
      email: 'banned@example.com',
      status: CustomerStatus.banned,
      firstName: 'X',
      lastName: 'Y',
      randomHash: null,
      expireRandomHash: null,
      ...overrides,
    };
  }

  it('loginByMobile → 405 and no SMS', async () => {
    const h = makeHarness({ nodeEnv: 'production', rows: [bannedRow()] });
    const err = await httpError(
      h.service.loginByMobile({ mobile: IR_MOBILE } as any),
    );
    expect(err.getStatus()).toBe(405);
    expect(h.amootsmsService.sendOTP).not.toHaveBeenCalled();
  });

  it('legacy resend (type=login) → 405 and no SMS or new code', async () => {
    const h = makeHarness({ nodeEnv: 'production', rows: [bannedRow()] });
    const err = await httpError(
      h.service.sendOtpCode({ mobile: IR_MOBILE, type: 'login' } as any),
    );
    expect(err.getStatus()).toBe(405);
    expect(h.amootsmsService.sendOTP).not.toHaveBeenCalled();
    expect(h.rows[0].randomHash).toBeNull();
  });

  it('legacy resend by email → 405', async () => {
    const h = makeHarness({ nodeEnv: 'development', rows: [bannedRow()] });
    const err = await httpError(
      h.service.sendOtpCode({
        email: 'banned@example.com',
        type: 'login',
      } as any),
    );
    expect(err.getStatus()).toBe(405);
    expect(h.rows[0].randomHash).toBeNull();
  });

  it('verifyLogin with a still-valid code issued before the ban → 405, stays banned', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      rows: [
        bannedRow({
          randomHash: '66666',
          expireRandomHash: moment().add(4, 'minutes').toDate(),
        }),
      ],
    });
    const err = await httpError(
      h.service.verifyLogin({ mobile: IR_MOBILE, code: '66666' } as any),
    );
    expect(err.getStatus()).toBe(405);
    expect(h.rows[0].status).toBe(CustomerStatus.banned);
    expect(h.rows[0].save).not.toHaveBeenCalled();
  });
});

describe('Customer OTP — legacy sendOtpCode and signup paths', () => {
  it('sendOtpCode delivers to the stored mobile, then persists', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      rows: [
        {
          id: 2,
          mobile: IR_MOBILE,
          email: 'a@example.com',
          status: CustomerStatus.inactive,
          randomHash: null,
          expireRandomHash: null,
        },
      ],
    });
    await expect(
      h.service.sendOtpCode({ email: 'a@example.com', type: 'signup' } as any),
    ).resolves.toBe(true);
    expect(h.amootsmsService.sendOTP).toHaveBeenCalledWith(
      IR_MOBILE,
      DETERMINISTIC_RANDOM_CODE,
    );
    expect(h.rows[0].randomHash).toBe(DETERMINISTIC_RANDOM_CODE);
  });

  it('sendOtpCode provider failure → 503 and code not stored', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      vatan: false,
      rows: [
        {
          id: 2,
          mobile: TR_MOBILE,
          status: CustomerStatus.inactive,
          randomHash: null,
          expireRandomHash: null,
        },
      ],
    });
    const err = await httpError(
      h.service.sendOtpCode({ mobile: TR_MOBILE, type: 'signup' } as any),
    );
    expect(err.getStatus()).toBe(503);
    expect(h.rows[0].randomHash).toBeNull();
    expect(h.rows[0].save).not.toHaveBeenCalled();
  });

  it('sendOtpCode for an email-only customer fails closed instead of crashing', async () => {
    const h = makeHarness({
      nodeEnv: 'production',
      rows: [
        {
          id: 3,
          mobile: null,
          email: 'e@example.com',
          status: CustomerStatus.inactive,
          randomHash: null,
          expireRandomHash: null,
        },
      ],
    });
    const err = await httpError(
      h.service.sendOtpCode({ email: 'e@example.com', type: 'signup' } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(h.rows[0].randomHash).toBeNull();
  });

  it('signup provider failure leaves the new row without a usable code', async () => {
    const h = makeHarness({ nodeEnv: 'production', amoot: false });
    const err = await httpError(
      h.service.signup({ mobile: IR_MOBILE, firstName: 'N' } as any),
    );
    expect(err.getStatus()).toBe(503);
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0].randomHash).toBeNull();
    expect(h.inserted[0].expireRandomHash).toBeNull();
    await expect(
      h.service.verifySignupByCode({
        mobile: IR_MOBILE,
        code: DETERMINISTIC_RANDOM_CODE,
      } as any),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('signup success stores the delivered code', async () => {
    const h = makeHarness({ nodeEnv: 'production' });
    await h.service.signup({ mobile: IR_MOBILE, firstName: 'N' } as any);
    expect(h.amootsmsService.sendOTP).toHaveBeenCalledWith(
      IR_MOBILE,
      DETERMINISTIC_RANDOM_CODE,
    );
    expect(h.inserted[0].randomHash).toBe(DETERMINISTIC_RANDOM_CODE);
  });

  it('email-only signup outside developer mode fails closed before insert', async () => {
    const h = makeHarness({ nodeEnv: 'production' });
    const err = await httpError(
      h.service.signup({ email: 'new@example.com', firstName: 'N' } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(h.inserted).toHaveLength(0);
  });

  it('email-only signup in development stores the fixed code', async () => {
    const h = makeHarness({ nodeEnv: 'development' });
    await h.service.signup({ email: 'new@example.com', firstName: 'N' } as any);
    expect(h.inserted[0].randomHash).toBe(FIXED_DEV_OTP_CODE);
  });
});

describe('Customer OTP — fields scrubbed from Admin responses', () => {
  const seeded = {
    id: 9,
    mobile: IR_MOBILE,
    status: CustomerStatus.active,
    password: 'hashed',
    previousPassword: 'old-hashed',
    randomHash: '77777',
    expireRandomHash: moment().add(4, 'minutes').toDate(),
  };

  it('getByIdForAdmin omits OTP and password fields', async () => {
    const h = makeHarness({ nodeEnv: 'production', rows: [seeded] });
    const customer: any = await h.service.getByIdForAdmin(9);
    expect(customer.id).toBe(9);
    expect(customer.mobile).toBe(IR_MOBILE);
    for (const key of [
      'randomHash',
      'expireRandomHash',
      'password',
      'previousPassword',
    ]) {
      expect(customer).not.toHaveProperty(key);
    }
  });

  it('getAllForAdmin omits OTP and password fields', async () => {
    const h = makeHarness({ nodeEnv: 'production', rows: [seeded] });
    const result: any = await h.service.getAllForAdmin(1, 20);
    expect(result.items).toHaveLength(1);
    for (const key of [
      'randomHash',
      'expireRandomHash',
      'password',
      'previousPassword',
    ]) {
      expect(result.items[0]).not.toHaveProperty(key);
    }
  });
});

describe('Customer OTP — rate-limit metadata is preserved', () => {
  const meta = (method: keyof CustomerController) =>
    Reflect.getMetadata(
      AUTH_RATE_LIMIT_KEY,
      CustomerController.prototype[method] as any,
    );

  it.each([
    ['loginByMobile', 'otpSend'],
    ['verifyLogin', 'otpVerify'],
    ['sendOtpCode', 'otpSend'],
    ['signup', 'otpSend'],
    ['verifySignupByCode', 'otpVerify'],
    ['forgotPassword', 'otpSend'],
  ] as const)('%s keeps kind=%s', (method, kind) => {
    expect(meta(method)).toEqual(expect.objectContaining({ kind }));
  });
});
