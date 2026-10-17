import {
  AssortmentLaunchConfigError,
  isStagingLaunchEnv,
  validateAssortmentLaunchRuntimeConfig,
} from './assortment-launch-config.util';

describe('assortment launch config (staging fail-closed)', () => {
  it('isStagingLaunchEnv only for staging|pre-staging|uat', () => {
    expect(isStagingLaunchEnv({ DEPLOY_ENV: 'staging' })).toBe(true);
    expect(isStagingLaunchEnv({ DEPLOY_ENV: 'pre-staging' })).toBe(true);
    expect(isStagingLaunchEnv({ DEPLOY_ENV: 'uat' })).toBe(true);
    expect(isStagingLaunchEnv({ DEPLOY_ENV: 'development' })).toBe(false);
    expect(isStagingLaunchEnv({ DEPLOY_ENV: 'production' })).toBe(false);
    expect(isStagingLaunchEnv({})).toBe(false);
  });

  it('skips when NODE_ENV=test even if DEPLOY_ENV=staging', () => {
    expect(() =>
      validateAssortmentLaunchRuntimeConfig({
        NODE_ENV: 'test',
        DEPLOY_ENV: 'staging',
      }),
    ).not.toThrow();
  });

  it('skips non-staging environments (dev defaults remain off)', () => {
    expect(() =>
      validateAssortmentLaunchRuntimeConfig({
        NODE_ENV: 'development',
        DEPLOY_ENV: 'development',
      }),
    ).not.toThrow();
  });

  it('accepts exact staging contract', () => {
    expect(() =>
      validateAssortmentLaunchRuntimeConfig({
        NODE_ENV: 'production',
        DEPLOY_ENV: 'staging',
        ASSORTMENT_DISCOVERY_ENFORCEMENT: '1',
        ASSORTMENT_COMMERCE_ENFORCEMENT: '1',
        ASSORTMENT_CRAWLER_ENFORCEMENT: '1',
        CATALOG_MAPPING_V2: '1',
      }),
    ).not.toThrow();
  });

  it('rejects missing flags on staging', () => {
    expect(() =>
      validateAssortmentLaunchRuntimeConfig({
        NODE_ENV: 'production',
        DEPLOY_ENV: 'staging',
      }),
    ).toThrow(AssortmentLaunchConfigError);
  });

  it('rejects truthy-but-not-1 misformatted flags', () => {
    expect(() =>
      validateAssortmentLaunchRuntimeConfig({
        NODE_ENV: 'production',
        DEPLOY_ENV: 'pre-staging',
        ASSORTMENT_DISCOVERY_ENFORCEMENT: 'true',
        ASSORTMENT_COMMERCE_ENFORCEMENT: '1',
        ASSORTMENT_CRAWLER_ENFORCEMENT: '1',
        CATALOG_MAPPING_V2: '1',
      }),
    ).toThrow(/ASSORTMENT_DISCOVERY_ENFORCEMENT must be exactly '1'/);
  });

  it('error message does not echo secret-looking values', () => {
    try {
      validateAssortmentLaunchRuntimeConfig({
        NODE_ENV: 'production',
        DEPLOY_ENV: 'staging',
        CRAWLER_INTERNAL_SECRET: 'super-secret-value',
      });
      fail('expected throw');
    } catch (err) {
      const msg = String((err as Error).message);
      expect(msg).not.toContain('super-secret-value');
      expect(msg).toContain('Staging assortment configuration invalid');
    }
  });
});
