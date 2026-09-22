import {
  BaseEntity,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index('uq_private_receipt_object_objectKey', ['objectKey'], { unique: true })
@Entity('private_receipt_object')
export class PrivateReceiptObjectEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'objectKey', length: 36 })
  objectKey: string;

  @Column('varchar', { name: 'storageKey', length: 512 })
  storageKey: string;

  @Column('varchar', { name: 'originalFilename', length: 255 })
  originalFilename: string;

  @Column('varchar', { name: 'mimeType', length: 128 })
  mimeType: string;

  @Column('int', { name: 'sizeBytes' })
  sizeBytes: number;

  @Column('varchar', { name: 'sha256', length: 64 })
  sha256: string;

  @Column('int', { name: 'customerId' })
  customerId: number;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;
}
