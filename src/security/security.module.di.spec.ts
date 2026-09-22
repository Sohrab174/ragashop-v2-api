import { Test, TestingModule } from '@nestjs/testing';
import { SecurityModule } from './security.module';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

/**
 * Regression: Nest previously treated AuthRateLimitService's optional ctor
 * config? as an injectable Object token and failed real app bootstrap.
 */
describe('SecurityModule Nest DI', () => {
  it('resolves AuthRateLimitService through Nest DI with zero-arg constructor', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [SecurityModule],
    }).compile();

    const service = moduleRef.get(AuthRateLimitService);
    expect(service).toBeInstanceOf(AuthRateLimitService);
    expect(typeof service.consume).toBe('function');
    expect(service.getProfile('login').maxPerIp).toBeGreaterThan(0);

    const guard = moduleRef.get(AuthRateLimitGuard);
    expect(guard).toBeInstanceOf(AuthRateLimitGuard);

    await moduleRef.close();
  });

  it('createForTests remains available for deterministic unit specs', () => {
    const service = AuthRateLimitService.createForTests({
      now: () => 1000,
      maxKeys: 50,
      login: { windowMs: 1000, maxPerIp: 2, maxPerIdentity: 2 },
      otpSend: { windowMs: 1000, maxPerIp: 2, maxPerIdentity: 2 },
      otpVerify: { windowMs: 1000, maxPerIp: 2, maxPerIdentity: 2 },
    });

    expect(service.consume('login', '1.1.1.1', 'a@b.com', 'email')).toBe(true);
    expect(service.consume('login', '1.1.1.1', 'a@b.com', 'email')).toBe(true);
    expect(service.consume('login', '1.1.1.1', 'a@b.com', 'email')).toBe(false);
  });
});
