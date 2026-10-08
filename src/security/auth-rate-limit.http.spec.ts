import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import * as request from 'supertest';
import * as express from 'express';
import { AuthController } from '../modules/auth/auth.controller';
import { AuthService } from '../modules/auth/auth.service';
import { CustomerController } from '../modules/customer/customer.controller';
import { CustomerService } from '../modules/customer/customer.service';
import { ConfigurationService } from '../config/configuration.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { JwtAuthGuard } from '../modules/auth/jwt/jwt.guard';
import { CustomerJwtAuthGuard } from '../modules/customer/jwt/jwt.guard';
import { RolesGuard } from '../modules/auth/role/role.guard';
import { ErrorService } from '../error/error.service';
import { UserCapabilityService } from '../modules/manual-payment/user-capability.service';
import {
  configureExpressTrustProxy,
  parseTrustProxySetting,
} from '../modules/marketplace-import/trust-proxy.util';
import { createHelmetMiddleware } from './helmet.util';
import {
  createCorsOriginDelegate,
  isSwaggerEnabled,
  resolveCorsAllowedOrigins,
} from './security-config.util';

describe('Auth login rate limiting (HTTP 429)', () => {
  let app: INestApplication;
  const authService = {
    login: jest.fn().mockResolvedValue({ token: 't' }),
    getById: jest.fn(),
    changePassword: jest.fn(),
    update: jest.fn(),
    forgotPassword: jest.fn(),
    resetPasswordByToken: jest.fn(),
  };

  beforeAll(async () => {
    const rateLimitService = AuthRateLimitService.createForTests({
      now: () => Date.now(),
      maxKeys: 100,
      login: { windowMs: 60_000, maxPerIp: 3, maxPerIdentity: 100 },
      otpSend: { windowMs: 60_000, maxPerIp: 3, maxPerIdentity: 3 },
      otpVerify: { windowMs: 60_000, maxPerIp: 3, maxPerIdentity: 3 },
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AuthRateLimitService, useValue: rateLimitService },
        AuthRateLimitGuard,
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true } as CanActivate)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows normal login then returns 429 after threshold', async () => {
    const payload = {
      emailOrMobile: 'admin@example.com',
      password: 'x',
      rememberMe: true,
    };

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send(payload);
      expect(res.status).toBe(200);
    }

    const throttled = await request(app.getHttpServer())
      .post('/auth/login')
      .send(payload);
    expect(throttled.status).toBe(429);
    expect(authService.login).toHaveBeenCalledTimes(3);
  });
});

describe('Customer OTP phone identity rate limiting (HTTP 429)', () => {
  let app: INestApplication;
  const customerService = {
    loginByMobile: jest.fn().mockResolvedValue({ mobile: 'x' }),
    verifyLogin: jest.fn(),
    login: jest.fn(),
    getActiveById: jest.fn(),
    updateMe: jest.fn(),
    changePassword: jest.fn(),
    forgotPassword: jest.fn(),
    resetPasswordByToken: jest.fn(),
    signup: jest.fn(),
    verifySignupByCode: jest.fn(),
    sendOtpCode: jest.fn(),
  };
  // Deny-by-default: OTP routes carry no capability requirement, so this must never be consulted.
  const capabilityService = {
    userHasCapability: jest.fn().mockResolvedValue(false),
    assertUserHasCapability: jest.fn().mockRejectedValue(new Error('denied')),
  };

  beforeAll(async () => {
    const rateLimitService = AuthRateLimitService.createForTests({
      now: () => Date.now(),
      maxKeys: 100,
      login: { windowMs: 60_000, maxPerIp: 1000, maxPerIdentity: 1000 },
      otpSend: { windowMs: 60_000, maxPerIp: 1000, maxPerIdentity: 3 },
      otpVerify: { windowMs: 60_000, maxPerIp: 1000, maxPerIdentity: 3 },
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CustomerController],
      providers: [
        { provide: CustomerService, useValue: customerService },
        { provide: ConfigurationService, useValue: {} },
        { provide: AuthRateLimitService, useValue: rateLimitService },
        { provide: UserCapabilityService, useValue: capabilityService },
        AuthRateLimitGuard,
        RolesGuard,
        ErrorService,
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true } as CanActivate)
      .overrideGuard(CustomerJwtAuthGuard)
      .useValue({ canActivate: () => true } as CanActivate)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hits shared identity threshold across equivalent mobile representations', async () => {
    const representations = ['09121234567', '+989121234567', '00989121234567'];

    for (const mobile of representations) {
      const res = await request(app.getHttpServer())
        .post('/customers/login/mobile')
        .send({ mobile });
      expect(res.status).toBe(201);
    }

    const blocked = await request(app.getHttpServer())
      .post('/customers/login/mobile')
      .send({ mobile: '989121234567' });
    expect(blocked.status).toBe(429);

    const persianBlocked = await request(app.getHttpServer())
      .post('/customers/login/mobile')
      .send({ mobile: '۰۹۱۲۱۲۳۴۵۶۷' });
    expect(persianBlocked.status).toBe(429);

    expect(customerService.loginByMobile).toHaveBeenCalledTimes(3);
    expect(capabilityService.userHasCapability).not.toHaveBeenCalled();
  });

  it('does not share buckets across different phone numbers', async () => {
    const first = await request(app.getHttpServer())
      .post('/customers/login/mobile')
      .send({ mobile: '09129990001' });
    const second = await request(app.getHttpServer())
      .post('/customers/login/mobile')
      .send({ mobile: '09129990002' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });
});

describe('security bootstrap helpers', () => {
  it('applies helmet headers without crashing', async () => {
    const app = express();
    configureExpressTrustProxy(app, parseTrustProxySetting({}));
    app.use(createHelmetMiddleware({ swaggerEnabled: false, env: {} }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('cors delegate + swagger defaults compose for local launch', () => {
    const env = {
      NODE_ENV: 'development',
      SITE_BASE_URL: 'http://127.0.0.1:4445',
      PANEL_BASE_URL: 'http://127.0.0.1:4445',
    } as NodeJS.ProcessEnv;
    const origins = resolveCorsAllowedOrigins(env);
    expect(createCorsOriginDelegate(origins)).toBeInstanceOf(Function);
    expect(isSwaggerEnabled(env)).toBe(true);
  });
});
