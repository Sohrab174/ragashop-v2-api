import {
  BaseEntity,
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Single-row policy version state (id = 1). */
@Entity('assortment_policy_state')
export class AssortmentPolicyStateEntity extends BaseEntity {
  @PrimaryColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'policyVersion', default: 0 })
  policyVersion: number;

  @UpdateDateColumn({ name: 'updatedAt', type: 'datetime' })
  updatedAt: Date;
}
