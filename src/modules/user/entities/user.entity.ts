import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AfterLoad } from 'typeorm/decorator/listeners/AfterLoad';
import { BeforeInsert } from 'typeorm/decorator/listeners/BeforeInsert';
import { BeforeUpdate } from 'typeorm/decorator/listeners/BeforeUpdate';
import * as bcrypt from 'bcryptjs';

export enum UserRoles {
  admin = 'admin',
  employee = 'employee',
}
export enum UserStatus {
  active = 'active',
  inactive = 'inactive',
}

@Entity('user')
export class UserEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column('varchar', { name: 'firstName', length: 45 })
  firstName: string;

  @Column('varchar', { name: 'lastName', length: 45 })
  lastName: string;

  @Column('varchar', { name: 'email', length: 255 })
  email: string;

  @Column('varchar', { name: 'mobile', nullable: true, length: 45 })
  mobile: string | null;

  @Column('varchar', { name: 'password', length: 128 })
  password: string;

  @Column('enum', {
    name: 'role',
    enum: UserRoles,
    default: () => UserRoles.admin,
  })
  role: UserRoles;

  @Column('varchar', { name: 'randomHash', nullable: true, length: 128 })
  randomHash: string | null;

  @Column('datetime', { name: 'expireRandomHash', nullable: true })
  expireRandomHash: Date | null;

  @Column('enum', {
    name: 'status',
    enum: UserStatus,
    default: () => UserStatus.active,
  })
  status: UserStatus;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

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
