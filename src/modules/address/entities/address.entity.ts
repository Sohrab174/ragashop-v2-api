import {
  BaseEntity,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';
import { CustomerEntity } from '../../customer/entities/customer.entity';
import { CityEntity } from '../../city/entities/city.entity';

@Index('fk_address_city1_idx', ['cityId'], {})
@Index('fk_address_customer1_idx', ['customerId'], {})
@Entity('address')
export class AddressEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('int', { name: 'customerId' })
  customerId: number;

  @Column('varchar', { name: 'title', length: 45 })
  title: string;

  @Column('text', { name: 'address' })
  address: string;

  @Column('varchar', { name: 'details', nullable: true, length: 128 })
  details: string | null;

  @Column('int', { name: 'cityId', nullable: true })
  cityId: number | null;

  @Column('varchar', { name: 'location', nullable: true, length: 45 })
  location: string | null;

  @Column('varchar', { name: 'phone', nullable: true, length: 45 })
  phone: string | null;

  @Column('varchar', { name: 'postalCode', nullable: true, length: 45 })
  postalCode: string | null;

  @Column('tinyint', {
    name: 'isDefault',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isDefault: boolean;

  @Column('tinyint', {
    name: 'isDeleted',
    width: 1,
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isDeleted: boolean;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @ManyToOne(() => CustomerEntity, (user) => user.addresses, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'userId', referencedColumnName: 'id' }])
  customer: CustomerEntity;

  @ManyToOne(() => CityEntity, (city) => city.addresses, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'cityId', referencedColumnName: 'id' }])
  city: CityEntity;
}
