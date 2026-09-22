import {
  looksLikePhoneIdentity,
  normalizeAuthRateLimitIdentity,
} from './auth-rate-limit-identity.util';
import { AuthRateLimitService } from './auth-rate-limit.service';

describe('normalizeAuthRateLimitIdentity', () => {
  const equivalents = [
    '09121234567',
    '+989121234567',
    '00989121234567',
    '989121234567',
    ' ۰۹۱۲۱۲۳۴۵۶۷ ',
    '٠٩١٢١٢٣٤٥٦٧',
    '0912-123-4567',
    '(0912)1234567',
    '+98 912 123 4567',
  ];

  it('maps equivalent Iranian mobiles to one canonical key', () => {
    const keys = equivalents.map((v) =>
      normalizeAuthRateLimitIdentity(v, 'mobile'),
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('+989121234567');
  });

  it('keeps distinct real phone numbers separate', () => {
    expect(normalizeAuthRateLimitIdentity('09121234567', 'mobile')).not.toBe(
      normalizeAuthRateLimitIdentity('09121111111', 'mobile'),
    );
  });

  it('does not treat emails as phones', () => {
    expect(normalizeAuthRateLimitIdentity('Admin@Example.com', 'email')).toBe(
      'admin@example.com',
    );
    expect(
      normalizeAuthRateLimitIdentity('admin@example.com', 'emailOrMobile'),
    ).toBe('admin@example.com');
    expect(
      normalizeAuthRateLimitIdentity('admin@example.com', 'emailOrMobile'),
    ).not.toContain('+98');
  });

  it('does not +98-prefix alphabetic usernames', () => {
    expect(normalizeAuthRateLimitIdentity('AdminUser', 'emailOrMobile')).toBe(
      'adminuser',
    );
    expect(looksLikePhoneIdentity('AdminUser')).toBe(false);
  });

  it('fail-safes empty/malformed without throwing', () => {
    expect(normalizeAuthRateLimitIdentity('')).toBe('anonymous');
    expect(normalizeAuthRateLimitIdentity(null)).toBe('anonymous');
    expect(() =>
      normalizeAuthRateLimitIdentity('++not-a-phone', 'mobile'),
    ).not.toThrow();
  });
});

describe('AuthRateLimitService phone identity bucket', () => {
  function createService(maxPerIdentity: number) {
    return AuthRateLimitService.createForTests({
      now: () => 1000,
      maxKeys: 100,
      login: { windowMs: 60_000, maxPerIp: 1000, maxPerIdentity },
      otpSend: { windowMs: 60_000, maxPerIp: 1000, maxPerIdentity },
      otpVerify: { windowMs: 60_000, maxPerIp: 1000, maxPerIdentity },
    });
  }

  it('shares one identity threshold across equivalent phone representations', () => {
    const service = createService(3);

    expect(service.consume('otpSend', '1.1.1.1', '09121234567', 'mobile')).toBe(
      true,
    );
    expect(
      service.consume('otpSend', '1.1.1.1', '+989121234567', 'mobile'),
    ).toBe(true);
    expect(
      service.consume('otpSend', '1.1.1.1', '00989121234567', 'mobile'),
    ).toBe(true);
    expect(
      service.consume('otpSend', '1.1.1.1', '989121234567', 'mobile'),
    ).toBe(false);
    expect(service.consume('otpSend', '1.1.1.1', '۰۹۱۲۱۲۳۴۵۶۷', 'mobile')).toBe(
      false,
    );
  });

  it('keeps different mobiles on separate buckets', () => {
    const service = createService(1);

    expect(
      service.consume('otpVerify', '2.2.2.2', '09120000001', 'mobile'),
    ).toBe(true);
    expect(
      service.consume('otpVerify', '2.2.2.2', '09120000002', 'mobile'),
    ).toBe(true);
    expect(
      service.consume('otpVerify', '2.2.2.2', '+989120000001', 'mobile'),
    ).toBe(false);
  });

  it('preserves email identity case-insensitivity without phone rewrite', () => {
    const service = createService(2);

    expect(
      service.consume('login', '3.3.3.3', 'User@Example.com', 'emailOrMobile'),
    ).toBe(true);
    expect(
      service.consume('login', '3.3.3.3', 'user@example.com', 'emailOrMobile'),
    ).toBe(true);
    expect(
      service.consume('login', '3.3.3.3', 'USER@EXAMPLE.COM', 'emailOrMobile'),
    ).toBe(false);
  });

  it('still enforces IP limit independently of phone canonicalization', () => {
    const service = AuthRateLimitService.createForTests({
      now: () => 1000,
      maxKeys: 100,
      login: { windowMs: 60_000, maxPerIp: 2, maxPerIdentity: 100 },
      otpSend: { windowMs: 60_000, maxPerIp: 2, maxPerIdentity: 100 },
      otpVerify: { windowMs: 60_000, maxPerIp: 2, maxPerIdentity: 100 },
    });

    expect(service.consume('login', '9.9.9.9', '09121111111', 'mobile')).toBe(
      true,
    );
    expect(service.consume('login', '9.9.9.9', '09122222222', 'mobile')).toBe(
      true,
    );
    expect(service.consume('login', '9.9.9.9', '09123333333', 'mobile')).toBe(
      false,
    );
  });

  it('recovers after window elapses for canonical phone identity', () => {
    let now = 1000;
    const service = AuthRateLimitService.createForTests({
      now: () => now,
      maxKeys: 100,
      login: { windowMs: 1000, maxPerIp: 100, maxPerIdentity: 1 },
      otpSend: { windowMs: 1000, maxPerIp: 100, maxPerIdentity: 1 },
      otpVerify: { windowMs: 1000, maxPerIp: 100, maxPerIdentity: 1 },
    });

    expect(service.consume('otpSend', '8.8.8.8', '09121234567', 'mobile')).toBe(
      true,
    );
    expect(
      service.consume('otpSend', '8.8.8.8', '+989121234567', 'mobile'),
    ).toBe(false);
    now += 2000;
    expect(
      service.consume('otpSend', '8.8.8.8', '00989121234567', 'mobile'),
    ).toBe(true);
  });
});
