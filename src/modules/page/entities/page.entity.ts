import {
  BaseEntity,
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { NavMenuEntity } from '../../nav-menu/entities/nav-menu.entity';
import { PageSectionItemEntity } from './page-section-item.entity';
import { PageSectionEntity } from './page-section.entity';

@Entity('page')
export class PageEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'code', length: 45, nullable: true })
  code: string | null;

  @Column('varchar', { name: 'title', length: 128 })
  title: string;

  @Column('text', { name: 'content', nullable: true })
  content: string | null;

  @Column('tinyint', {
    name: 'isLocked',
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isLocked: boolean;

  @Column('tinyint', {
    name: 'isDeleted',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isDeleted: boolean;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt', nullable: true })
  updatedAt: Date | null;

  /**
   * Relations
   */
  @OneToMany(() => NavMenuEntity, (navMenu) => navMenu.page)
  navMenus: NavMenuEntity[];

  @OneToMany(() => PageSectionEntity, (pageSection) => pageSection.page)
  sections: PageSectionEntity[];

  @OneToMany(
    () => PageSectionItemEntity,
    (pageSectionItem) => pageSectionItem.page,
  )
  pageSectionItems: PageSectionItemEntity[];
}
