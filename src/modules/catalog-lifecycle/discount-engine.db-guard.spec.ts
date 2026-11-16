import {
  assertExpectedDatabaseName,
  DiscountEngineDatabaseGuardError,
  resolveExpectedDatabaseFromEnv,
} from './discount-engine.db-guard';

describe('discount-engine db guard', () => {
  it('accepts matching active database', () => {
    expect(assertExpectedDatabaseName('ragashop_local', 'ragashop_local')).toBe(
      'ragashop_local',
    );
  });

  it('rejects mismatched database', () => {
    expect(() =>
      assertExpectedDatabaseName('ragashop_production', 'ragashop_local'),
    ).toThrow(DiscountEngineDatabaseGuardError);
  });

  it('rejects missing expected database', () => {
    expect(() => assertExpectedDatabaseName('ragashop_local', '')).toThrow(
      DiscountEngineDatabaseGuardError,
    );
  });

  it('rejects missing actual database', () => {
    expect(() => assertExpectedDatabaseName(null, 'ragashop_local')).toThrow(
      DiscountEngineDatabaseGuardError,
    );
  });

  it('reads expected database from env', () => {
    expect(
      resolveExpectedDatabaseFromEnv({
        DISCOUNT_ENGINE_EXPECTED_DATABASE: 'ragashop_local',
      } as any),
    ).toBe('ragashop_local');
    expect(resolveExpectedDatabaseFromEnv({} as any)).toBeUndefined();
  });
});
