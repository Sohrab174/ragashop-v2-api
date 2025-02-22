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
import { ProductEntity } from './product.entity';

export enum ProductGalleryType {
  photo = 'photo',
  video = 'video',
}

@Index('fk_product_gallery_product1_idx', ['productId'], {})
@Entity('product_gallery')
export class ProductGalleryEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'productId', nullable: true })
  productId: number | null;

  @Column('enum', {
    name: 'type',
    enum: ProductGalleryType,
    default: () => ProductGalleryType.photo,
  })
  type: ProductGalleryType;

  @Column('varchar', { name: 'source', nullable: true, length: 128 })
  source: string | null;

  @Column('varchar', { name: 'pathFile', length: 128 })
  pathFile: string;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @ManyToOne(() => ProductEntity, (product) => product.productGalleries, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'productId', referencedColumnName: 'id' }])
  product: ProductEntity;

  @OneToMany(() => ProductEntity, (product) => product.cover)
  products: ProductEntity[];
}
