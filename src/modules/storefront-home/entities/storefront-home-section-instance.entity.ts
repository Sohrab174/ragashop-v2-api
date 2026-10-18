import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';

/**
 * Repeatable homepage section. The singleton storefront_home_section table
 * stays the source of the published page until a layout marker is saved here.
 */
@Entity('storefront_home_section_instance')
export class StorefrontHomeSectionInstanceEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'instanceKey', length: 64, unique: true })
  instanceKey: string;

  @Column('varchar', { name: 'sectionType', length: 32 })
  sectionType: string;

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

  @Column('mediumtext', { name: 'configJson', nullable: true })
  configJson: string | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt', nullable: true })
  updatedAt: Date | null;
}
