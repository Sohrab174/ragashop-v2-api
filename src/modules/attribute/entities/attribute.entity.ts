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

  @Column('int', { name: 'sourceId' })
  sourceId: number;

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
