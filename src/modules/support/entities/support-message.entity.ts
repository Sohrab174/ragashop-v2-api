import {
  BaseEntity,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SupportSenderType } from '../support.types';

@Index('idx_support_message_request', ['supportRequestId'])
@Entity('support_message')
export class SupportMessageEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'supportRequestId' })
  supportRequestId: number;

  @Column('varchar', { name: 'senderType', length: 16 })
  senderType: SupportSenderType;

  @Column('int', { name: 'customerId', nullable: true })
  customerId: number | null;

  @Column('int', { name: 'userId', nullable: true })
  userId: number | null;

  @Column('text', { name: 'body' })
  body: string;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;
}
