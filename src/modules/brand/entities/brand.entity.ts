import { ProductEntity } from 'src/modules/product/entities/product.entity';
import {
  BaseEntity,
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('brand')
export class BrandEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'sourceId' })
  sourceId: number;

  @Column('varchar', { name: 'name', length: 255 })
  name: string;

  @Column('tinyint', { name: 'isSelection', width: 1, default: () => "'0'" })
  isSelection: boolean;

  @Column('text', { name: 'description', nullable: true })
  description: string | null;

  /**
   * Relations
   */
  @OneToMany(() => ProductEntity, (product) => product.brand)
  products: ProductEntity[];
}
