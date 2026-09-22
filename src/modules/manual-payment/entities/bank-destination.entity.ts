import {
  BaseEntity,
  Column,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { ManualPaymentRail } from '../manual-payment.types';

@Entity('bank_destination')
export class BankDestinationEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'bankName', length: 128 })
  bankName: string;

  @Column('varchar', { name: 'accountHolderName', length: 255 })
  accountHolderName: string;

  @Column('varchar', { name: 'cardNumber', nullable: true, length: 32 })
  cardNumber: string | null;

  @Column('varchar', { name: 'iban', nullable: true, length: 34 })
  iban: string | null;

  @Column('varchar', { name: 'accountNumber', nullable: true, length: 64 })
  accountNumber: string | null;

  @Column('tinyint', {
    name: 'enabled',
    default: () => "'1'",
    transformer: new BooleanTransformer(),
  })
  enabled: boolean;

  @Column('json', { name: 'allowedRails' })
  allowedRails: ManualPaymentRail[];

  @Column('int', { name: 'displayOrder', default: () => "'0'" })
  displayOrder: number;

  @Column('text', { name: 'instructions', nullable: true })
  instructions: string | null;

  @Column('decimal', {
    name: 'minAmountIrt',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  minAmountIrt: number | null;

  @Column('decimal', {
    name: 'maxAmountIrt',
    nullable: true,
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  maxAmountIrt: number | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('int', { name: 'createdBy', nullable: true })
  createdBy: number | null;

  @Column('datetime', { name: 'updatedAt' })
  updatedAt: Date;

  @Column('int', { name: 'updatedBy', nullable: true })
  updatedBy: number | null;
}
