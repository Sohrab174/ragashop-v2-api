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

export enum OrderStatusType {
  pending = 'pending',
  accepted = 'accepted',
  rejected = 'rejected',
  paid = 'paid',
  sent = 'sent',
  delivered = 'delivered',
  buyFromSource = 'buy_from_source',
  sendToDestination = 'send_to_destination',
}

@Index('fk_order_status_order1_idx', ['orderId'], {})
@Entity('order_status')
export class OrderStatusEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'orderId' })
  orderId: number;

  @Column('int', { name: 'userId', nullable: true })
  userId: number | null;

  @Column('enum', {
    name: 'type',
    enum: OrderStatusType,
    default: () => OrderStatusType.pending,
  })
  type: OrderStatusType;

  @Column('text', { name: 'description', nullable: true })
  description: string | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @ManyToOne(() => OrderEntity, (order) => order.orderStatuses, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'orderId', referencedColumnName: 'id' }])
  order: OrderEntity;
}
