import {
  BaseEntity,
  Column,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { ManualPaymentRail } from '../manual-payment.types';

@Entity('manual_payment_method')
export class ManualPaymentMethodEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('enum', {
    name: 'rail',
    enum: ManualPaymentRail,
    unique: true,
  })
  rail: ManualPaymentRail;

  @Column('tinyint', {
    name: 'enabled',
    default: () => "'1'",
    transformer: new BooleanTransformer(),
  })
  enabled: boolean;

  @Column('int', { name: 'displayOrder', default: () => "'0'" })
  displayOrder: number;

  @Column('text', { name: 'customerInstructions', nullable: true })
  customerInstructions: string | null;

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

  @Column('datetime', { name: 'updatedAt' })
  updatedAt: Date;
}
