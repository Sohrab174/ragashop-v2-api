import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProductEntity } from '../../product/entities/product.entity';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { CustomerEntity } from '../../customer/entities/customer.entity';

@Index('fk_product_favorite_product1_idx', ['productId'], {})
@Index('fk_product_favorite_customer1_idx', ['customerId'], {})
@Entity('product_favorite')
export class ProductFavoriteEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'customerId' })
  customerId: number;

  @Column('int', { name: 'productId' })
  productId: number;

  @Column('tinyint', {
    name: 'isDeleted',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isDeleted: boolean;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @ManyToOne(() => ProductEntity, (product) => product.favorites, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'productId', referencedColumnName: 'id' }])
  product: ProductEntity;

  @ManyToOne(() => CustomerEntity, (customer) => customer.productFavorites, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'customerId', referencedColumnName: 'id' }])
  customer: CustomerEntity;
}
