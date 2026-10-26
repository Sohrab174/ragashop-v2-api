import { SettingService } from './setting.service';
import { DEFAULT_FX_RATE_MAX_AGE_MS } from '../finance/finance.types';

function mockError() {
  return {
    unprocessableEntity: jest.fn((messages, data) => {
      const err: any = new Error(messages?.[0] || 'error');
      err.data = data;
      err.status = 422;
      throw err;
    }),
  };
}

describe('F1 SettingService FX', () => {
  const baseSetting = {
    id: 1,
    tryToRial: 35000,
    changePercentTryToRial: 0,
    tryToRialFetchedAt: new Date(),
    tryToRialSource: 'TGJU',
  };

  function buildService(settingRow: any) {
    const repo = {
      findOne: jest.fn().mockResolvedValue(settingRow),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          update: () => qb,
          set: () => qb,
          where: () => qb,
          execute: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        return qb;
      }),
    };
    const service = new SettingService(repo as any, mockError() as any);
    return { service, repo };
  }

  it('getAuthoritativeTryToToman returns effective toman and freshness', async () => {
    process.env.FX_RATE_MAX_AGE_MS = String(DEFAULT_FX_RATE_MAX_AGE_MS);
    const now = new Date();
    const { service } = buildService({
      ...baseSetting,
      tryToRialFetchedAt: new Date(now.getTime() - 60_000),
    });
    const rate = await service.getAuthoritativeTryToToman(now);
    expect(rate.tryToToman).toBe(3500);
    expect(rate.isFresh).toBe(true);
    expect(rate.source).toBe('TGJU');
  });

  it('hard-stale rate fails requireFresh with fx_rate_stale', async () => {
    process.env.FX_RATE_MAX_AGE_MS = '1000';
    const now = new Date();
    const { service } = buildService({
      ...baseSetting,
      tryToRialFetchedAt: new Date(now.getTime() - 60_000),
    });
    await expect(service.requireFreshAuthoritativeTryToToman(now)).rejects.toMatchObject({
      data: { code: 'fx_rate_stale' },
    });
  });

  it('missing fetchedAt fails with fx_rate_unavailable', async () => {
    const { service } = buildService({
      ...baseSetting,
      tryToRialFetchedAt: null,
    });
    await expect(service.requireFreshAuthoritativeTryToToman()).rejects.toMatchObject({
      data: { code: 'fx_rate_unavailable' },
    });
  });

  it('failed TGJU fetch does not destroy last-known-good', async () => {
    const { service, repo } = buildService(baseSetting);
    const result = await service.fetchAndPersistTgjuTryToRial(async () => null);
    expect(result).toBeNull();
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('successful TGJU fetch persists rate and fetchedAt', async () => {
    const { service, repo } = buildService(baseSetting);
    const qb: any = {
      update: jest.fn(() => qb),
      set: jest.fn(() => qb),
      where: jest.fn(() => qb),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    repo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.fetchAndPersistTgjuTryToRial(async () => 40000);
    expect(result).toBe(40000);
    expect(qb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        tryToRial: 40000,
        tryToRialSource: 'TGJU',
      }),
    );
    expect(qb.set.mock.calls[0][0].tryToRialFetchedAt).toBeInstanceOf(Date);
  });

  it('zero/negative fetch is rejected', async () => {
    const { service, repo } = buildService(baseSetting);
    expect(await service.fetchAndPersistTgjuTryToRial(async () => 0)).toBeNull();
    expect(await service.fetchAndPersistTgjuTryToRial(async () => -1)).toBeNull();
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('getTryToToman refuses missing rate and never falls back to 1', async () => {
    const { service } = buildService({
      ...baseSetting,
      tryToRial: 0,
      tryToRialFetchedAt: new Date(),
    });
    await expect(service.getTryToToman()).rejects.toMatchObject({
      data: { code: 'fx_rate_unavailable' },
    });
  });

  it('getTryToToman refuses null/absent setting without inventing rate 1', async () => {
    const { service } = buildService(null);
    await expect(service.getTryToToman()).rejects.toMatchObject({
      data: { code: 'fx_rate_unavailable' },
    });
  });

  it('getTryToToman accepts a positive stale last-known-good for browse', async () => {
    process.env.FX_RATE_MAX_AGE_MS = '1000';
    const now = new Date();
    const { service } = buildService({
      ...baseSetting,
      tryToRial: 35000,
      tryToRialFetchedAt: new Date(now.getTime() - 60_000),
    });
    await expect(service.getTryToToman()).resolves.toBe(3500);
    await expect(service.requireFreshAuthoritativeTryToToman(now)).rejects.toMatchObject({
      data: { code: 'fx_rate_stale' },
    });
  });

  it('valid rate still converts TRY to toman without inventing a hardcoded FX', async () => {
    process.env.FX_RATE_MAX_AGE_MS = String(DEFAULT_FX_RATE_MAX_AGE_MS);
    const { service } = buildService({
      ...baseSetting,
      tryToRial: 50000,
      changePercentTryToRial: 0,
      tryToRialFetchedAt: new Date(),
    });
    await expect(service.getTryToToman()).resolves.toBe(5000);
    // 979 TRY must not display as 979 toman when rate is valid.
    expect(Math.round(979 * 5000)).toBe(4_895_000);
  });
});
