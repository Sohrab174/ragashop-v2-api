import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from './Product';

@Index('fk_product_gallery_product1_idx', ['productId'], {})
@Entity('product_gallery', { schema: 'ragashop' })
export class ProductGallery {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'productId' })
  productId: number;

  @Column('enum', {
    name: 'type',
    enum: ['photo', 'video'],
    default: () => "'photo'",
  })
  type: 'photo' | 'video';

  @Column('enum', { name: 'source', nullable: true, enum: ['trendyol'] })
  source: 'trendyol' | null;

  @Column('varchar', { name: 'pathFile', length: 128 })
  pathFile: string;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @OneToMany(() => Product, (product) => product.cover)
  products: Product[];

  @ManyToOne(() => Product, (product) => product.productGalleries, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'productId', referencedColumnName: 'id' }])
  product: Product;
}
