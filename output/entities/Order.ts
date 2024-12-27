import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Customer } from './Customer';
import { OrderItem } from './OrderItem';
import { Transaction } from './Transaction';

@Index('fk_order_customer1_idx', ['customerId'], {})
@Entity('order', { schema: 'ragashop' })
export class Order {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'number', length: 45 })
  number: string;

  @Column('int', { name: 'customerId', nullable: true })
  customerId: number | null;

  @Column('decimal', { name: 'amount', precision: 20, scale: 2 })
  amount: string;

  @Column('decimal', {
    name: 'discount',
    nullable: true,
    precision: 10,
    scale: 2,
    default: () => "'0.00'",
  })
  discount: string | null;

  @Column('decimal', { name: 'shipping', precision: 20, scale: 2 })
  shipping: string;

  @Column('decimal', {
    name: 'tax',
    nullable: true,
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
  })
  tax: string | null;

  @Column('decimal', { name: 'finalAmount', precision: 20, scale: 2 })
  finalAmount: string;

  @Column('text', { name: 'address', nullable: true })
  address: string | null;

  @Column('text', { name: 'description', nullable: true })
  description: string | null;

  @Column('enum', {
    name: 'status',
    enum: ['pending', 'accepted', 'rejected', 'paid', 'sent', 'delivered'],
    default: () => "'pending'",
  })
  status: 'pending' | 'accepted' | 'rejected' | 'paid' | 'sent' | 'delivered';

  @Column('varchar', { name: 'reasonRejected', nullable: true, length: 255 })
  reasonRejected: string | null;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @ManyToOne(() => Customer, (customer) => customer.orders, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn([{ name: 'customerId', referencedColumnName: 'id' }])
  customer: Customer;

  @OneToMany(() => OrderItem, (orderItem) => orderItem.order)
  orderItems: OrderItem[];

  @OneToMany(() => Transaction, (transaction) => transaction.order)
  transactions: Transaction[];
}
