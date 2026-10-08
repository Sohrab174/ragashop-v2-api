import {
  BaseEntity,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only assortment policy audit.
 * Services must never UPDATE or DELETE rows.
 */
@Index('idx_apa_ruleId_createdAt', ['ruleId', 'createdAt'])
@Index('idx_apa_createdAt', ['createdAt'])
@Entity('assortment_policy_audit')
export class AssortmentPolicyAuditEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', name: 'id' })
  id: string;

  @Column('varchar', { name: 'operation', length: 64 })
  operation: string;

  @Column('int', { name: 'ruleId', nullable: true })
  ruleId: number | null;

  @Column('varchar', { name: 'actor', length: 128, nullable: true })
  actor: string | null;

  @Column('json', { name: 'beforeJson', nullable: true })
  beforeJson: Record<string, unknown> | null;

  @Column('json', { name: 'afterJson', nullable: true })
  afterJson: Record<string, unknown> | null;

  @Column('int', { name: 'policyVersion', nullable: true })
  policyVersion: number | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;
}
