import {
  BaseEntity,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SupportCategory, SupportStatus } from '../support.types';

@Index('idx_support_request_customer', ['customerId'])
@Index('idx_support_request_order', ['orderId'])
@Entity('support_request')
export class SupportRequestEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'customerId' })
  customerId: number;

  @Column('int', { name: 'orderId', nullable: true })
  orderId: number | null;

  @Column('varchar', { name: 'category', length: 32 })
  category: SupportCategory;

  @Column('varchar', { name: 'subject', length: 120 })
  subject: string;

  @Column('varchar', { name: 'status', length: 32 })
  status: SupportStatus;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt' })
  updatedAt: Date;
}
