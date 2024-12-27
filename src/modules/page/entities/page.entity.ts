import {
  BaseEntity,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';

@Index('fk_page_company1_idx', ['companyId'], {})
@Entity('page')
export class PageEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'companyId' })
  companyId: number;

  @Column('varchar', { name: 'code', length: 128 })
  code: string;

  @Column('tinyint', {
    name: 'isLocked',
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isLocked: boolean;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt', nullable: true })
  updatedAt: Date | null;
}
