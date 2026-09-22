import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderEntity } from './order.entity';
import { TransactionEntity } from '../../transaction/entities/transaction.entity';

@Index('uq_order_payment_finalization_orderId', ['orderId'], { unique: true })
@Entity('order_payment_finalization')
export class OrderPaymentFinalizationEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'orderId' })
  orderId: number;

  @Column('int', { name: 'transactionId' })
  transactionId: number;

  @Column('datetime', { name: 'finalizedAt' })
  finalizedAt: Date;

  @ManyToOne(() => OrderEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'orderId', referencedColumnName: 'id' }])
  order: OrderEntity;

  @ManyToOne(() => TransactionEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'transactionId', referencedColumnName: 'id' }])
  transaction: TransactionEntity;
}
