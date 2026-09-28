import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addColumnIfMissing,
  dropColumnIfExists,
  tableExists,
} from '../migration-utils';

/**
 * ACCOUNT-1 — recipient name on the existing customer address book.
 * Order rows stay an immutable delivery snapshot and are not altered.
 */
export class account1AddressRecipient1930000000001
  implements MigrationInterface
{
  name = 'account1AddressRecipient1930000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'address'))) return;

    await addColumnIfMissing(
      queryRunner,
      'address',
      'recipientFirstName',
      '`recipientFirstName` varchar(45) NULL DEFAULT NULL AFTER `phone`',
    );
    await addColumnIfMissing(
      queryRunner,
      'address',
      'recipientLastName',
      '`recipientLastName` varchar(45) NULL DEFAULT NULL AFTER `recipientFirstName`',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await tableExists(queryRunner, 'address'))) return;
    await dropColumnIfExists(queryRunner, 'address', 'recipientLastName');
    await dropColumnIfExists(queryRunner, 'address', 'recipientFirstName');
  }
}
