import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DecimalTransformer } from '../../../utils/transformers/DecimalTransformer';

@Entity('setting')
export class SettingEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'phone', nullable: true, length: 128 })
  phone: string | null;

  @Column('varchar', { name: 'email', nullable: true, length: 128 })
  email: string | null;

  @Column('varchar', { name: 'address', nullable: true, length: 255 })
  address: string | null;

  @Column('varchar', { name: 'location', nullable: true, length: 128 })
  location: string | null;

  @Column('varchar', { name: 'instagram', nullable: true, length: 128 })
  instagram: string | null;

  @Column('varchar', { name: 'linkedin', nullable: true, length: 128 })
  linkedin: string | null;

  @Column('varchar', { name: 'telegram', nullable: true, length: 128 })
  telegram: string | null;

  @Column('varchar', { name: 'twitter', nullable: true, length: 128 })
  twitter: string | null;

  @Column('varchar', { name: 'facebook', nullable: true, length: 128 })
  facebook: string | null;

  @Column('varchar', { name: 'whatsapp', nullable: true, length: 128 })
  whatsapp: string | null;

  @Column('decimal', {
    name: 'maxShippingCost',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  maxShippingCost: number;

  @Column('decimal', {
    name: 'shippingPercent',
    precision: 10,
    scale: 2,
    default: () => "'5.00'",
    transformer: new DecimalTransformer(),
  })
  shippingPercent: number;

  @Column('decimal', {
    name: 'invitedByReferrerCreditUSD',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  invitedByReferrerCreditUSD: number;

  @Column('decimal', {
    name: 'invitedByReferrerCreditIRT',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  invitedByReferrerCreditIRT: number;

  @Column('decimal', {
    name: 'invitedByReferrerCreditTRY',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  invitedByReferrerCreditTRY: number;

  @Column('decimal', {
    name: 'buyPercentToReferrerCreditUSD',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  buyPercentToReferrerCreditUSD: number;

  @Column('decimal', {
    name: 'buyPercentToReferrerCreditIRT',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  buyPercentToReferrerCreditIRT: number;

  @Column('decimal', {
    name: 'buyPercentToReferrerCreditTRY',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  buyPercentToReferrerCreditTRY: number;

  @Column('decimal', {
    name: 'vat',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  vat: number;

  @Column('text', { name: 'noticeBeforeOrdering', nullable: true })
  noticeBeforeOrdering: string | null;

  @Column('int', { name: 'minDeliveryDay', default: () => "'10'" })
  minDeliveryDay: number;

  @Column('int', { name: 'maxDeliveryDay', default: () => "'15'" })
  maxDeliveryDay: number;

  @Column('decimal', {
    name: 'tryToRial',
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
    transformer: new DecimalTransformer(),
  })
  tryToRial: number;
}
