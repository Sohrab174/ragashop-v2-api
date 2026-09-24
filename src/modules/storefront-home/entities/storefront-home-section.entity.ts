import {
  BaseEntity,
  Column,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';

/**
 * HOME-1 typed Home section row — business configuration authority.
 * sectionKey is validated against STOREFRONT_HOME_SECTION_KEYS whitelist.
 */
@Entity('storefront_home_section')
export class StorefrontHomeSectionEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'sectionKey', length: 64, unique: true })
  sectionKey: string;

  @Column('tinyint', {
    name: 'enabled',
    width: 1,
    default: () => "'1'",
    transformer: new BooleanTransformer(),
  })
  enabled: boolean;

  @Column('int', { name: 'displayOrder', default: () => "'100'" })
  displayOrder: number;

  @Column('varchar', { name: 'title', nullable: true, length: 128 })
  title: string | null;

  @Column('varchar', { name: 'subtitle', nullable: true, length: 255 })
  subtitle: string | null;

  @Column('text', { name: 'configJson', nullable: true })
  configJson: string | null;

  @Column('datetime', { name: 'startAt', nullable: true })
  startAt: Date | null;

  @Column('datetime', { name: 'endAt', nullable: true })
  endAt: Date | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt', nullable: true })
  updatedAt: Date | null;
}
