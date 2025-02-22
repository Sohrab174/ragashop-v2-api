import {
  Column,
  Entity,
  BaseEntity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AttributeEntity } from './attribute.entity';
import { ProductAttributeValueEntity } from '../../product/entities/product-attribute-value.entity';

@Index('fk_attribute_value_attribute1_idx', ['attributeId'], {})
@Entity('attribute_value')
export class AttributeValueEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'attributeId' })
  attributeId: number;

  @Column('varchar', { name: 'source', nullable: true, length: 128 })
  source: string | null;

  @Column('varchar', { name: 'sourceId', nullable: true, length: 128 })
  sourceId: string | null;

  @Column('varchar', { name: 'sourceName', nullable: true, length: 128 })
  sourceName: string | null;

  @Column('varchar', { name: 'name', length: 128 })
  name: string;

  @Column('varchar', { name: 'extraValue', nullable: true, length: 128 })
  extraValue: string | null;

  /**
   * Relations
   */
  @ManyToOne(() => AttributeEntity, (attribute) => attribute.values, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'attributeId', referencedColumnName: 'id' }])
  attribute: AttributeEntity;

  @OneToMany(
    () => ProductAttributeValueEntity,
    (productAttributeValue) => productAttributeValue.attributeValue,
  )
  productAttributeValues: ProductAttributeValueEntity[];
}
