import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { CategoryEntity } from '../../../category/entities/category.entity';
import {
  AssortmentPolicyMatchType,
  AssortmentPolicyStatus,
} from '../assortment-policy.types';

export enum AssortmentPolicyRuleMatchType {
  path_prefix = 'path_prefix',
  category = 'category',
}

export enum AssortmentPolicyRuleStatus {
  IN_SCOPE = 'IN_SCOPE',
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
}

@Unique('uq_apr_selectorKey', ['selectorKey'])
@Index('idx_apr_active_match', ['isActive', 'matchType'])
@Index('idx_apr_provider_path', ['provider', 'pathPrefixNorm'])
@Index('idx_apr_categoryId', ['categoryId'])
@Entity('assortment_policy_rule')
export class AssortmentPolicyRuleEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'provider', length: 128, nullable: true })
  provider: string | null;

  @Column('enum', {
    name: 'matchType',
    enum: AssortmentPolicyRuleMatchType,
  })
  matchType: AssortmentPolicyMatchType;

  @Column('varchar', { name: 'pathPrefixNorm', length: 512, nullable: true })
  pathPrefixNorm: string | null;

  @Column('int', { name: 'categoryId', nullable: true })
  categoryId: number | null;

  @Column('varchar', { name: 'selectorKey', length: 640 })
  selectorKey: string;

  @Column('enum', {
    name: 'status',
    enum: AssortmentPolicyRuleStatus,
  })
  status: AssortmentPolicyStatus;

  @Column('varchar', { name: 'reasonCode', length: 64 })
  reasonCode: string;

  @Column('varchar', { name: 'businessDomain', length: 64, nullable: true })
  businessDomain: string | null;

  @Column('varchar', { name: 'note', length: 512, nullable: true })
  note: string | null;

  @Column('tinyint', {
    name: 'isActive',
    width: 1,
    default: () => "'1'",
  })
  isActive: boolean;

  @Column('varchar', { name: 'createdBy', length: 128, nullable: true })
  createdBy: string | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('varchar', { name: 'updatedBy', length: 128, nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updatedAt', type: 'datetime' })
  updatedAt: Date;

  @ManyToOne(() => CategoryEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    nullable: true,
  })
  @JoinColumn([{ name: 'categoryId', referencedColumnName: 'id' }])
  category: CategoryEntity | null;
}
