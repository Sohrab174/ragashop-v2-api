import {
  Column,
  Entity,
  BaseEntity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { AttributeValueEntity } from './attribute-value.entity';

export enum AttributeTypes {
  color = 'color',
  other = 'other',
}

@Entity('attribute')
export class AttributeEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'source', nullable: true, length: 128 })
  source: string | null;

  @Column('varchar', { name: 'sourceId', length: 128 })
  sourceId: string;

  @Column('varchar', { name: 'sourceName', nullable: true, length: 128 })
  sourceName: string | null;

  @Column('varchar', { name: 'name', length: 255 })
  name: string;

  @Column('enum', {
    name: 'type',
    enum: AttributeTypes,
    default: () => AttributeTypes.other,
  })
  type: AttributeTypes;

  /**
   * Relations
   */
  @OneToMany(
    () => AttributeValueEntity,
    (attributeValue) => attributeValue.attribute,
  )
  values: AttributeValueEntity[];
}
