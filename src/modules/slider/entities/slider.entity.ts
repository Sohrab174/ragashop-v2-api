import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum SliderType {
  photo = 'photo',
  video = 'video',
}
export enum SliderPositions {
  top = 'top',
  center = 'center',
}

@Entity('slider')
export class SliderEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('enum', {
    name: 'type',
    enum: SliderType,
    default: () => SliderType.photo,
  })
  type: SliderType;

  @Column('varchar', { name: 'pathFile', length: 128 })
  pathFile: string;

  @Column('varchar', { name: 'title', nullable: true, length: 128 })
  title: string | null;

  @Column('varchar', { name: 'description', nullable: true, length: 255 })
  description: string | null;

  @Column('varchar', { name: 'url', nullable: true, length: 255 })
  url: string | null;

  @Column('enum', {
    name: 'position',
    enum: SliderPositions,
    default: () => SliderPositions.top,
  })
  position: SliderPositions;

  @Column('int', { name: 'displayOrder', default: () => "'1'" })
  displayOrder: number;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;
}
