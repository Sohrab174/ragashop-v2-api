import {
  BaseEntity,
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProductEntity } from '../../product/entities/product.entity';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';

@Entity('brand')
export class BrandEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'source', nullable: true, length: 128 })
  source: string | null;

  @Column('varchar', { name: 'sourceId', nullable: true, length: 128 })
  sourceId: string | null;

  @Column('varchar', { name: 'sourceName', nullable: true, length: 128 })
  sourceName: string | null;

  @Column('varchar', { name: 'name', length: 255 })
  name: string;

  @Column('tinyint', {
    name: 'isSelection',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isSelection: boolean;

  @Column('tinyint', {
    name: 'isVirtual',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isVirtual: boolean;

  @Column('text', { name: 'description', nullable: true })
  description: string | null;

  /**
   * Relations
   */
  @OneToMany(() => ProductEntity, (product) => product.brand)
  products: ProductEntity[];
}
