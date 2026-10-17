import {
  DEFAULT_UAT_DATABASE_NAME,
  isUatFixedOtpEnabled,
  resolveUatRequiredDatabaseName,
  UatFixedOtpConfigError,
  validateUatFixedOtpRuntimeConfig,
} from './uat-fixed-otp.util';

function env(partial: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return partial as NodeJS.ProcessEnv;
}

describe('isUatFixedOtpEnabled', () => {
  const valid = {
    UAT_FIXED_OTP: '1',
    DEPLOY_ENV: 'uat',
    DATABASE_NAME: DEFAULT_UAT_DATABASE_NAME,
  };

  it('enables only when flag, deploy env, and isolated DB name all match', () => {
    expect(isUatFixedOtpEnabled(env(valid))).toBe(true);
  });

  it.each([
    ['missing flag', { ...valid, UAT_FIXED_OTP: undefined }],
    ['flag true not 1', { ...valid, UAT_FIXED_OTP: 'true' }],
    ['wrong deploy env', { ...valid, DEPLOY_ENV: 'staging' }],
    ['production deploy', { ...valid, DEPLOY_ENV: 'production' }],
    ['wrong database', { ...valid, DATABASE_NAME: 'ragashop_local' }],
    ['empty database', { ...valid, DATABASE_NAME: '' }],
    ['missing database', { ...valid, DATABASE_NAME: undefined }],
  ])('stays disabled for %s', (_label, partial) => {
    expect(isUatFixedOtpEnabled(env(partial))).toBe(false);
  });

  it('is case-insensitive on DATABASE_NAME', () => {
    expect(
      isUatFixedOtpEnabled(
        env({ ...valid, DATABASE_NAME: 'RagaShop_V2_UAT' }),
      ),
    ).toBe(true);
  });
});

describe('validateUatFixedOtpRuntimeConfig', () => {
  it('no-ops when the UAT flag is unset', () => {
    expect(() =>
      validateUatFixedOtpRuntimeConfig(
        env({ NODE_ENV: 'production', DATABASE_NAME: 'ragashop_local' }),
      ),
    ).not.toThrow();
  });

  it('skips in Jest even when misconfigured', () => {
    expect(() =>
      validateUatFixedOtpRuntimeConfig(
        env({
          NODE_ENV: 'test',
          UAT_FIXED_OTP: '1',
          DEPLOY_ENV: 'production',
          DATABASE_NAME: 'ragashop_local',
        }),
      ),
    ).not.toThrow();
  });

  it('refuses UAT flag against the local development database', () => {
    expect(() =>
      validateUatFixedOtpRuntimeConfig(
        env({
          NODE_ENV: 'production',
          UAT_FIXED_OTP: '1',
          DEPLOY_ENV: 'uat',
          DATABASE_NAME: 'ragashop_local',
        }),
      ),
    ).toThrow(UatFixedOtpConfigError);
  });

  it('accepts a correctly isolated UAT configuration', () => {
    expect(() =>
      validateUatFixedOtpRuntimeConfig(
        env({
          NODE_ENV: 'production',
          UAT_FIXED_OTP: '1',
          DEPLOY_ENV: 'uat',
          DATABASE_NAME: DEFAULT_UAT_DATABASE_NAME,
        }),
      ),
    ).not.toThrow();
  });

  it('rejects production-like required database names', () => {
    expect(() =>
      validateUatFixedOtpRuntimeConfig(
        env({
          NODE_ENV: 'production',
          UAT_FIXED_OTP: '1',
          DEPLOY_ENV: 'uat',
          DATABASE_NAME: 'ragashop',
          UAT_REQUIRED_DATABASE_NAME: 'ragashop',
        }),
      ),
    ).toThrow(/production-like/);
  });
});

describe('resolveUatRequiredDatabaseName', () => {
  it('defaults to ragashop_v2_uat', () => {
    expect(resolveUatRequiredDatabaseName(env({}))).toBe(
      DEFAULT_UAT_DATABASE_NAME,
    );
  });
});
