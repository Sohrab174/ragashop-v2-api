export class DiscountEngineDatabaseGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscountEngineDatabaseGuardError';
  }
}

/**
 * Local smoke / operator CLI identity check.
 * Compares the live connection DATABASE() to an explicit expected name.
 * Never logs credentials.
 */
export function assertExpectedDatabaseName(
  actualDatabase: string | null | undefined,
  expectedDatabase: string | null | undefined,
): string {
  const actual = String(actualDatabase || '').trim();
  const expected = String(expectedDatabase || '').trim();
  if (!expected) {
    throw new DiscountEngineDatabaseGuardError(
      'DISCOUNT_ENGINE_EXPECTED_DATABASE is required for this operator run',
    );
  }
  if (!actual) {
    throw new DiscountEngineDatabaseGuardError(
      'Active database identity is missing or ambiguous',
    );
  }
  if (actual !== expected) {
    throw new DiscountEngineDatabaseGuardError(
      `Active database "${actual}" does not match expected "${expected}"`,
    );
  }
  return actual;
}

export function resolveExpectedDatabaseFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.DISCOUNT_ENGINE_EXPECTED_DATABASE;
  if (raw == null || String(raw).trim() === '') return undefined;
  return String(raw).trim();
}
