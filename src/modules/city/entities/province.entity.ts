import {
  BaseEntity,
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CityEntity } from './city.entity';

@Entity('province')
export class ProvinceEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'name', length: 128 })
  name: string;

  /**
   * Relations
   */
  @OneToMany(() => CityEntity, (city) => city.province)
  cities: CityEntity[];
}
