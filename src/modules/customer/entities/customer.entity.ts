import {
  BaseEntity,
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderEntity } from '../../order/entities/order.entity';

import { AfterLoad } from 'typeorm/decorator/listeners/AfterLoad';
import { BeforeInsert } from 'typeorm/decorator/listeners/BeforeInsert';
import { BeforeUpdate } from 'typeorm/decorator/listeners/BeforeUpdate';
import * as bcrypt from 'bcryptjs';
import { TransactionEntity } from '../../transaction/entities/transaction.entity';
import { AddressEntity } from '../../address/entities/address.entity';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';
import { WalletHistoryEntity } from './wallet-history.entity';
import { ProductFavoriteEntity } from '../../favorite/entities/product-favorite.entity';
import { BooleanTransformer } from '../../../utils/transformers/BooleanTransformer';

export enum CustomerStatus {
  active = 'active',
  inactive = 'inactive',
  banned = 'banned',
}

@Entity('customer')
export class CustomerEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'firstName', length: 45, nullable: true })
  firstName: string | null;

  @Column('varchar', { name: 'lastName', length: 45, nullable: true })
  lastName: string | null;

  @Column('varchar', { name: 'mobile', nullable: true, length: 45 })
  mobile: string | null;

  @Column('varchar', { name: 'email', nullable: true, length: 255 })
  email: string | null;

  @Column('varchar', { name: 'password', nullable: true, length: 128 })
  password: string | null;

  @Column('text', { name: 'address', nullable: true })
  address: string | null;

  @Column('varchar', {
    name: 'randomHash',
    nullable: true,
    length: 128,
  })
  randomHash: string | null;

  @Column('datetime', { name: 'expireRandomHash', nullable: true })
  expireRandomHash: Date | null;

  @Column('varchar', { name: 'referrerCode', nullable: true, length: 45 })
  referrerCode: string | null;

  @Column('varchar', { name: 'inviteCode', nullable: true, length: 45 })
  inviteCode: string | null;

  @Column('decimal', {
    name: 'walletUSD',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
    default: () => "'0.00'",
  })
  walletUSD: number;

  @Column('decimal', {
    name: 'walletIRT',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
    default: () => "'0.00'",
  })
  walletIRT: number;

  @Column('decimal', {
    name: 'walletTRY',
    precision: 20,
    scale: 2,
    transformer: new DecimalTransformer(),
    default: () => "'0.00'",
  })
  walletTRY: number;

  @Column('decimal', {
    name: 'buyPercentToReferrerCreditUSD',
    precision: 20,
    scale: 2,
    nullable: true,
    transformer: new DecimalTransformer(),
  })
  buyPercentToReferrerCreditUSD: number;

  @Column('decimal', {
    name: 'buyPercentToReferrerCreditIRT',
    precision: 20,
    scale: 2,
    nullable: true,
    transformer: new DecimalTransformer(),
  })
  buyPercentToReferrerCreditIRT: number;

  @Column('decimal', {
    name: 'buyPercentToReferrerCreditTRY',
    precision: 20,
    scale: 2,
    nullable: true,
    transformer: new DecimalTransformer(),
  })
  buyPercentToReferrerCreditTRY: number;

  @Column('enum', {
    name: 'status',
    enum: CustomerStatus,
    default: () => CustomerStatus.active,
  })
  status: CustomerStatus;

  @Column('tinyint', {
    name: 'isDeleted',
    default: () => "'0'",
    transformer: new BooleanTransformer(),
  })
  isDeleted: boolean;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  /**
   * Relations
   */
  @OneToMany(
    () => ProductFavoriteEntity,
    (productFavorite) => productFavorite.customer,
  )
  productFavorites: ProductFavoriteEntity[];

  @OneToMany(() => OrderEntity, (order) => order.customer)
  orders: OrderEntity[];

  @OneToMany(() => TransactionEntity, (transaction) => transaction.customer)
  transactions: TransactionEntity[];

  @OneToMany(() => AddressEntity, (address) => address.customer)
  addresses: AddressEntity[];

  @OneToMany(
    () => WalletHistoryEntity,
    (walletHistory) => walletHistory.customer,
  )
  walletHistories: WalletHistoryEntity[];

  @OneToMany(
    () => WalletHistoryEntity,
    (walletHistory) => walletHistory.relatedCustomer,
  )
  relatedWalletHistories: WalletHistoryEntity[];

  /**
   * Entity Listeners
   * https://typeorm.io/listeners-and-subscribers
   */
  public previousPassword: string;

  @AfterLoad()
  public loadPreviousPassword() {
    this.previousPassword = this.password;
  }

  @BeforeInsert()
  @BeforeUpdate()
  async setPassword() {
    if (this.previousPassword !== this.password && this.password) {
      const salt = await bcrypt.genSalt();
      this.password = await bcrypt.hash(this.password, salt);
    }
  }

  /**
   * Helpers
   */
  async isCorrectSaltPassword(plainPassword: string): Promise<boolean> {
    return await bcrypt.compare(plainPassword, this.password);
  }
}
