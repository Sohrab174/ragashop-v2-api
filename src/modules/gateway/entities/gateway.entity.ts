import {
  BaseEntity,
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { TransactionEntity } from '../../transaction/entities/transaction.entity';

export enum GatewayNames {
  sep = 'sep',
  bpm = 'bpm',
  zarinpal = 'zarinpal',
  zibal = 'zibal',
  payping = 'payping',
  dpoPay = 'dpo-pay',
}

export enum GatewayStatus {
  active = 'active',
  inactive = 'inactive',
}

@Entity('gateway')
export class GatewayEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('enum', {
    name: 'name',
    enum: GatewayNames,
    default: () => GatewayNames.zarinpal,
  })
  name: GatewayNames;

  @Column('varchar', { name: 'merchantId', nullable: true, length: 255 })
  merchantId: string | null;

  @Column('varchar', { name: 'username', nullable: true, length: 255 })
  username: string | null;

  @Column('varchar', { name: 'password', nullable: true, length: 255 })
  password: string | null;

  @Column('int', { name: 'displayOrder', default: () => "'1'" })
  displayOrder: number;

  @Column('enum', {
    name: 'status',
    enum: GatewayStatus,
    default: () => GatewayStatus.active,
  })
  status: GatewayStatus;

  @Column('tinyint', {
    name: 'isDeleted',
    transformer: new BooleanTransformer(),
    default: () => "'0'",
  })
  isDeleted: boolean;

  /**
   * Relations
   */
  @OneToMany(() => TransactionEntity, (transaction) => transaction.gateway)
  transactions: TransactionEntity[];
}
