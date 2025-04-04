import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CategoryEntity } from '../../category/entities/category.entity';
import { PageEntity } from '../../page/entities/page.entity';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';

export enum NavMenuPosition {
  header = 'header',
  footer1 = 'footer1',
  footer2 = 'footer2',
}

@Index('fk_nav_menu_category1_idx', ['categoryId'], {})
@Index('fk_nav_menu_page1_idx', ['pageId'], {})
@Entity('nav_menu', { schema: 'ragashop' })
export class NavMenuEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'title', length: 45 })
  title: string;

  @Column('int', { name: 'pageId', nullable: true })
  pageId: number | null;

  @Column('int', { name: 'categoryId', nullable: true })
  categoryId: number | null;

  @Column('varchar', { name: 'internalLink', nullable: true, length: 255 })
  internalLink: string | null;

  @Column('varchar', { name: 'externalLink', nullable: true, length: 255 })
  externalLink: string | null;

  @Column('enum', {
    name: 'position',
    enum: NavMenuPosition,
    default: () => NavMenuPosition.header,
  })
  position: NavMenuPosition;

  @Column('int', {
    name: 'displayOrder',
    default: () => "'1'",
  })
  displayOrder: number;

  @Column('tinyint', { name: 'isDeleted', width: 1, default: () => "'0'" })
  isDeleted: boolean;

  /**
   * Relations
   */
  @ManyToOne(() => CategoryEntity, (category) => category.navMenus, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'categoryId', referencedColumnName: 'id' }])
  category: CategoryEntity;

  @ManyToOne(() => PageEntity, (page) => page.navMenus, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'pageId', referencedColumnName: 'id' }])
  page: PageEntity;
}
