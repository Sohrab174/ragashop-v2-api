import {
  BaseEntity,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserCapabilityName } from '../manual-payment.types';

@Index('uq_user_capability_user_cap', ['userId', 'capability'], { unique: true })
@Entity('user_capability')
export class UserCapabilityEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'userId' })
  userId: number;

  @Column('varchar', { name: 'capability', length: 64 })
  capability: UserCapabilityName | string;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;
}
