import { resolveClientIp, normalizeClientIp } from './client-ip.util';

describe('normalizeClientIp', () => {
  it('normalizes IPv4-mapped IPv6', () => {
    expect(normalizeClientIp('::ffff:203.0.113.10')).toBe('203.0.113.10');
  });

  it('returns unknown for empty values', () => {
    expect(normalizeClientIp('')).toBe('unknown');
    expect(normalizeClientIp(undefined)).toBe('unknown');
  });
});

describe('resolveClientIp', () => {
  it('uses framework-resolved req.ip without manual xff parsing', () => {
    const req = {
      ip: '203.0.113.10',
      headers: { 'x-forwarded-for': '8.8.8.8' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    expect(resolveClientIp(req)).toBe('203.0.113.10');
  });

  it('falls back to socket remote address when req.ip is missing', () => {
    const req = {
      headers: { 'x-forwarded-for': '8.8.8.8' },
      socket: { remoteAddress: '10.0.0.5' },
    } as any;

    expect(resolveClientIp(req)).toBe('10.0.0.5');
  });
});
