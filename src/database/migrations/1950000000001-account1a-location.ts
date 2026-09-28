import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  dropColumnIfExists,
  tableExists,
} from '../migration-utils';

/**
 * ACCOUNT-1A — WGS84 latitude/longitude on Saved Address and Order snapshot.
 * Existing postalCode/location columns are reused; no fabricated coordinates.
 */
export class account1aLocation1950000000001 implements MigrationInterface {
  name = 'account1aLocation1950000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, 'address')) {
      await addColumnIfMissing(
        queryRunner,
        'address',
        'latitude',
        '`latitude` decimal(10,7) NULL DEFAULT NULL AFTER `location`',
      );
      await addColumnIfMissing(
        queryRunner,
        'address',
        'longitude',
        '`longitude` decimal(10,7) NULL DEFAULT NULL AFTER `latitude`',
      );
    }

    if (await tableExists(queryRunner, 'order')) {
      await addColumnIfMissing(
        queryRunner,
        'order',
        'latitude',
        '`latitude` decimal(10,7) NULL DEFAULT NULL AFTER `location`',
      );
      await addColumnIfMissing(
        queryRunner,
        'order',
        'longitude',
        '`longitude` decimal(10,7) NULL DEFAULT NULL AFTER `latitude`',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, 'order')) {
      await dropColumnIfExists(queryRunner, 'order', 'longitude');
      await dropColumnIfExists(queryRunner, 'order', 'latitude');
    }
    if (await tableExists(queryRunner, 'address')) {
      await dropColumnIfExists(queryRunner, 'address', 'longitude');
      await dropColumnIfExists(queryRunner, 'address', 'latitude');
    }
  }
}
