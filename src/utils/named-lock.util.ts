import { Connection } from 'typeorm';

/**
 * Short-lived MySQL named lock on a dedicated connection.
 * Caller must not perform slow external work inside fn().
 */
export async function withMysqlNamedLock<T>(
  connection: Connection,
  lockName: string,
  fn: () => Promise<T>,
  timeoutSeconds = 10,
): Promise<T> {
  const queryRunner = connection.createQueryRunner();
  await queryRunner.connect();
  try {
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
    return await fn();
  } finally {
    try {
      await queryRunner.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } catch {
      // Lock may already be released on connection close.
    }
    await queryRunner.release();
  }
}
