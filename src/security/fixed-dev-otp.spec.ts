import { isFixedDevOtpAllowed } from './security-config.util';

function env(nodeEnv: string | undefined): NodeJS.ProcessEnv {
  return { NODE_ENV: nodeEnv } as NodeJS.ProcessEnv;
}

describe('isFixedDevOtpAllowed', () => {
  it.each(['development', 'local', 'test'])(
    'allows the fixed OTP for explicit developer env %s',
    (nodeEnv) => {
      expect(isFixedDevOtpAllowed(env(nodeEnv))).toBe(true);
    },
  );

  it.each([
    ['production', 'production'],
    ['Production', 'mis-cased production'],
    ['PRODUCTION', 'upper-case production'],
    [' production ', 'padded production'],
    ['staging', 'staging'],
    ['stage', 'stage'],
    ['preview', 'unknown env'],
    ['prod', 'abbreviated production'],
    ['', 'empty'],
    ['Development', 'mis-cased development'],
    ['TEST', 'upper-case test'],
    [' development', 'padded development'],
    ['dev', 'abbreviated development'],
  ])('rejects NODE_ENV=%j (%s)', (nodeEnv) => {
    expect(isFixedDevOtpAllowed(env(nodeEnv))).toBe(false);
  });

  it('rejects an unset NODE_ENV', () => {
    expect(isFixedDevOtpAllowed(env(undefined))).toBe(false);
    expect(isFixedDevOtpAllowed({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
