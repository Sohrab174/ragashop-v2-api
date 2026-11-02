import { Logger } from '@nestjs/common';
import { Connection, QueryRunner } from 'typeorm';

const logger = new Logger('withMysqlNamedLock');

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safeReleaseLock(
  queryRunner: QueryRunner,
  lockName: string,
): Promise<void> {
  try {
    await queryRunner.query('SELECT RELEASE_LOCK(?)', [lockName]);
  } catch (err) {
    // Lock may already be released, or the connection may be unusable.
    logger.warn(
      `RELEASE_LOCK failed for ${lockName}: ${errorDetail(err)}`,
    );
  }
}

async function safeReleaseQueryRunner(
  queryRunner: QueryRunner,
  lockName: string,
): Promise<void> {
  try {
    if (!queryRunner.isReleased) {
      await queryRunner.release();
    }
  } catch (err) {
    // Never mask the primary success/error from the lock callback.
    logger.warn(
      `QueryRunner.release failed after named lock ${lockName}: ${errorDetail(err)}`,
    );
  }
}

/**
 * Short-lived MySQL named lock on a dedicated connection.
 * Caller must not perform slow external work inside fn().
 *
 * Cleanup failures (RELEASE_LOCK / queryRunner.release) are logged and swallowed
 * so they cannot overwrite a successful callback result or the original error.
 */
export async function withMysqlNamedLock<T>(
  connection: Connection,
  lockName: string,
  fn: () => Promise<T>,
  timeoutSeconds = 10,
): Promise<T> {
  const queryRunner = connection.createQueryRunner();
  let lockAcquired = false;

  try {
    await queryRunner.connect();

    const lockResult = await queryRunner.query(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [lockName, timeoutSeconds],
    );
    const acquired = Number(
      lockResult?.[0]?.acquired ?? lockResult?.[0]?.ACQUIRED,
    );
    if (acquired !== 1) {
      throw new Error(`Unable to acquire named lock: ${lockName}`);
    }
    lockAcquired = true;

    return await fn();
  } finally {
    if (lockAcquired) {
      await safeReleaseLock(queryRunner, lockName);
    }
    await safeReleaseQueryRunner(queryRunner, lockName);
  }
}
