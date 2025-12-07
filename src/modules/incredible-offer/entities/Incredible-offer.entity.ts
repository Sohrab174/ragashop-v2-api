import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { ProductEntity } from '../../product/entities/product.entity';
import { ProductAttributeValueEntity } from '../../product/entities/product-attribute-value.entity';
import { PageSectionItemEntity } from '../../page/entities/page-section-item.entity';

@Index('idx_offer_productId', ['productId'], {})
@Index('idx_offer_attrValueId', ['productAttributeValueId'], {})
@Index('idx_offer_fromDate', ['fromDate'], {})
@Index('idx_offer_toDate', ['toDate'], {})
@Entity('incredible_offer')
export class IncredibleOfferEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'productId' })
  productId: number;

  @Column('int', { name: 'productAttributeValueId', nullable: true })
  productAttributeValueId: number | null;

  @Column('decimal', {
    name: 'discountedPrice',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  discountedPrice: number;

  @Column('decimal', {
    name: 'discountPercent',
    precision: 10,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  discountPercent: number;

  @Column('datetime', { name: 'fromDate' })
  fromDate: Date;

  @Column('datetime', { name: 'toDate' })
  toDate: Date;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @ManyToOne(() => ProductEntity, (product) => product.incredibleOffers, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'productId', referencedColumnName: 'id' }])
  product: ProductEntity;

  @ManyToOne(
    () => ProductAttributeValueEntity,
    (productAttributeValue) => productAttributeValue.incredibleOffers,
    { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
  )
  @JoinColumn([{ name: 'productAttributeValueId', referencedColumnName: 'id' }])
  productAttributeValue: ProductAttributeValueEntity;

  @OneToMany(
    () => PageSectionItemEntity,
    (pageSectionItem) => pageSectionItem.incredibleOffer,
  )
  pageSectionItems: PageSectionItemEntity[];
}
