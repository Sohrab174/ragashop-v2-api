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
import { ProvinceEntity } from './province.entity';
import { OrderEntity } from '../../order/entities/order.entity';
import { AddressEntity } from '../../address/entities/address.entity';

@Index('fk_city_province1_idx', ['provinceId'], {})
@Entity('city')
export class CityEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'provinceId' })
  provinceId: number;

  @Column('varchar', { name: 'name', length: 128 })
  name: string;

  /**
   * Relations
   */
  @ManyToOne(() => ProvinceEntity, (province) => province.cities, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'provinceId', referencedColumnName: 'id' }])
  province: ProvinceEntity;

  @OneToMany(() => OrderEntity, (order) => order.city)
  orders: OrderEntity[];

  @OneToMany(() => AddressEntity, (address) => address.city)
  addresses: AddressEntity[];
}
