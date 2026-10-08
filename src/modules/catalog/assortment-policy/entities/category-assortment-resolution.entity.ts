import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { CategoryEntity } from '../../../category/entities/category.entity';
import {
  AssortmentPolicyStatus,
  AssortmentPolicyVia,
} from '../assortment-policy.types';
import {
  AssortmentPolicyRuleEntity,
  AssortmentPolicyRuleStatus,
} from './assortment-policy-rule.entity';

@Index('idx_car_status', ['status'])
@Index('idx_car_policyVersion', ['policyVersion'])
@Index('idx_car_ruleId', ['ruleId'])
@Entity('category_assortment_resolution')
export class CategoryAssortmentResolutionEntity extends BaseEntity {
  @PrimaryColumn({ type: 'int', name: 'categoryId' })
  categoryId: number;

  @Column('enum', {
    name: 'status',
    enum: AssortmentPolicyRuleStatus,
  })
  status: AssortmentPolicyStatus;

  @Column('varchar', { name: 'reasonCode', length: 64 })
  reasonCode: string;

  @Column('int', { name: 'ruleId', nullable: true })
  ruleId: number | null;

  @Column('varchar', { name: 'via', length: 32 })
  via: AssortmentPolicyVia;

  @Column('varchar', { name: 'businessDomain', length: 64, nullable: true })
  businessDomain: string | null;

  @Column('int', { name: 'policyVersion' })
  policyVersion: number;

  @Column('datetime', { name: 'resolvedAt' })
  resolvedAt: Date;

  @ManyToOne(() => CategoryEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'categoryId', referencedColumnName: 'id' }])
  category: CategoryEntity;

  @ManyToOne(() => AssortmentPolicyRuleEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    nullable: true,
  })
  @JoinColumn([{ name: 'ruleId', referencedColumnName: 'id' }])
  rule: AssortmentPolicyRuleEntity | null;
}
