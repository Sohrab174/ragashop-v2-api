import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProductEntity } from './product.entity';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';

@Index('fk_product_description_product1_idx', ['productId'], {})
@Entity('product_description')
export class ProductDescriptionEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'productId' })
  productId: number;

  @Column('varchar', { name: 'source', nullable: true, length: 128 })
  source: string | null;

  @Column('text', { name: 'sourceContent', nullable: true })
  sourceContent: string | null;

  @Column('text', { name: 'content', nullable: true })
  content: string | null;

  @Column('int', { name: 'displayOrder', default: () => "'1'" })
  displayOrder: number;

  @Column('tinyint', {
    name: 'isDeleted',
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isDeleted: boolean;

  /**
   * Relations
   */
  @ManyToOne(() => ProductEntity, (product) => product.productDescriptions, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'productId', referencedColumnName: 'id' }])
  product: ProductEntity;
}
