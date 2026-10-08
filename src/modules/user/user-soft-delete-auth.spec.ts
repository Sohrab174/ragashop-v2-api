import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ADMIN-V2-0 FIX A: soft-deleted Admin/Employee must not authenticate
 * and must not keep a usable JWT session.
 */
describe('soft-deleted admin/employee authentication (ADMIN-V2-0)', () => {
  const userServiceSrc = readFileSync(
    join(__dirname, 'user.service.ts'),
    'utf8',
  );
  const jwtStrategySrc = readFileSync(
    join(__dirname, '../auth/jwt/jwt.strategy.ts'),
    'utf8',
  );
  const authServiceSrc = readFileSync(
    join(__dirname, '../auth/auth.service.ts'),
    'utf8',
  );

  it('active-user query builders exclude isDeleted users', () => {
    expect(userServiceSrc).toMatch(
      /_findActiveBuilder\([\s\S]*?isDeleted:\s*false/,
    );
    expect(userServiceSrc).toMatch(
      /findActiveUserByMobileOrEmail[\s\S]*?isDeleted:\s*false/,
    );
  });

  it('login uses getActiveByEmailOrMobile (which uses the active builder)', () => {
    expect(authServiceSrc).toMatch(/getActiveByEmailOrMobile/);
    expect(userServiceSrc).toMatch(
      /getActiveByEmailOrMobile[\s\S]*?_findActiveBuilder/,
    );
  });

  it('JWT validate reloads the user via findActiveById each request', () => {
    expect(jwtStrategySrc).toMatch(/findActiveById\(payload\.id\)/);
    expect(userServiceSrc).toMatch(/findActiveById[\s\S]*?_findActiveBuilder/);
  });

  it('soft-delete sets isDeleted without changing status alone', () => {
    expect(userServiceSrc).toMatch(/set\(\{\s*isDeleted:\s*true\s*\}\)/);
  });
});
