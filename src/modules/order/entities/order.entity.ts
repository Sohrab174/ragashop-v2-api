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
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { CustomerEntity } from '../../customer/entities/customer.entity';
import { TransactionEntity } from '../../transaction/entities/transaction.entity';
import { OrderItemEntity } from './order-item.entity';
import { CityEntity } from '../../city/entities/city.entity';
import { OrderStatusEntity } from './order-status.entity';
import { WalletHistoryEntity } from '../../customer/entities/wallet-history.entity';

export enum OrderStatus {
  pending = 'pending',
  accepted = 'accepted',
  rejected = 'rejected',
  paid = 'paid',
  sent = 'sent',
  delivered = 'delivered',
  buyFromSource = 'buy_from_source',
  sendToDestination = 'send_to_destination',
}

@Index('fk_order_city1_idx', ['cityId'], {})
@Index('fk_order_customer1_idx', ['customerId'], {})
@Entity('order')
export class OrderEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'number', length: 45 })
  number: string;

  @Column('int', { name: 'customerId', nullable: true })
  customerId: number | null;

  @Column('decimal', {
    name: 'amount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  amount: number;

  @Column('decimal', {
    name: 'discount',
    nullable: true,
    precision: 10,
    scale: 2,
    transformer: new DecimalTransformer(),
    default: () => "'0.00'",
  })
  discount: number | null;

  @Column('decimal', {
    name: 'shipping',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  shipping: number;

  @Column('decimal', {
    name: 'tax',
    nullable: true,
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  tax: number | null;

  @Column('decimal', {
    name: 'finalAmount',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
  })
  finalAmount: number;

  @Column('varchar', { name: 'firstName', nullable: true, length: 45 })
  firstName: string | null;

  @Column('varchar', { name: 'lastName', nullable: true, length: 45 })
  lastName: string | null;

  @Column('text', { name: 'address', nullable: true })
  address: string | null;

  @Column('varchar', { name: 'location', nullable: true, length: 45 })
  location: string | null;

  @Column('varchar', { name: 'addressDetails', nullable: true, length: 45 })
  addressDetails: string | null;

  @Column('varchar', { name: 'postalCode', nullable: true, length: 45 })
  postalCode: string | null;

  @Column('varchar', { name: 'phone', nullable: true, length: 45 })
  phone: string | null;

  @Column('int', { name: 'cityId', nullable: true })
  cityId: number | null;

  @Column('text', { name: 'description', nullable: true })
  description: string | null;

  @Column('varchar', { name: 'postTrackingCode', nullable: true, length: 128 })
  postTrackingCode: string | null;

  @Column('enum', {
    name: 'status',
    enum: OrderStatus,
    default: () => OrderStatus.pending,
  })
  status: OrderStatus;

  @Column('varchar', { name: 'reasonRejected', nullable: true, length: 255 })
  reasonRejected: string | null;

  @Column('tinyint', { name: 'isDeleted', width: 1, default: () => "'0'" })
  isDeleted: boolean;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @ManyToOne(() => CustomerEntity, (customer) => customer.orders, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'customerId', referencedColumnName: 'id' }])
  customer: CustomerEntity;

  @OneToMany(() => OrderItemEntity, (orderItem) => orderItem.order)
  orderItems: OrderItemEntity[];

  @OneToMany(() => TransactionEntity, (transaction) => transaction.order)
  transactions: TransactionEntity[];

  @ManyToOne(() => CityEntity, (city) => city.orders, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'cityId', referencedColumnName: 'id' }])
  city: CityEntity;

  @OneToMany(() => OrderStatusEntity, (orderStatus) => orderStatus.order)
  orderStatuses: OrderStatusEntity[];

  @OneToMany(
    () => WalletHistoryEntity,
    (walletHistory) => walletHistory.relatedOrder,
  )
  walletHistories: WalletHistoryEntity[];
}
