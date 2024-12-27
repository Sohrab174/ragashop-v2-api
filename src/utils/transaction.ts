import { getConnection, QueryRunner } from 'typeorm';

/**
 * https://orkhan.gitbook.io/typeorm/docs/transactions
 */
export class Transaction {
  private queryRunner: QueryRunner;
  private ignoreCheckForeignKey: boolean;

  async start(ignoreCheckForeignKey = false) {
    this.ignoreCheckForeignKey = ignoreCheckForeignKey;

    // get a connection and create a new query runner
    const connection = getConnection();
    this.queryRunner = connection.createQueryRunner();

    // establish real database connection using our new query runner
    await this.queryRunner.connect();

    if (this.ignoreCheckForeignKey) {
      await this.queryRunner.query('SET FOREIGN_KEY_CHECKS = 0');
    }

    await this.queryRunner.startTransaction();
    return this.queryRunner;
  }

  // commit transaction
  async commit() {
    await this.queryRunner.commitTransaction();
  }

  // since we have errors let's rollback changes we made
  async rollback() {
    await this.queryRunner.rollbackTransaction();
  }

  // you need to release query runner which is manually created:
  async release() {
    if (this.ignoreCheckForeignKey) {
      await this.queryRunner.query('SET FOREIGN_KEY_CHECKS = 1');
    }
    await this.queryRunner.release();
  }
}
