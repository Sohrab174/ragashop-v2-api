import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as moment from 'jalali-moment';
import { Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import { MailService } from '../../mail/mail.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  paginationResult,
} from '../../utils';
import { CreateUserDto } from './dto/create-user.dto';
import { UserEntity, UserRoles, UserStatus } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,

    private error: ErrorService,
    private mail: MailService,
  ) {}

  /**
   * -------------------------------------------------------
   */
  async getAll(page = 1, limit = 20, filters = null, sorts = null) {
    let builder = this.userRepository.createQueryBuilder('user');

    builder.select([
      'user.id',
      'user.firstName',
      'user.lastName',
      'user.email',
      'user.mobile',
      'user.role',
      'user.status',
      'user.createdAt',
    ]);

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('user.createdAt', 'DESC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    // Custom condition
    builder.andWhere('user.role != :role', { role: UserRoles.god });

    const [items, totalItems] = await builder
      .take(limit) // LIMIT
      .skip((page - 1) * limit) // OFFSET
      .getManyAndCount();

    return {
      items,
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   */
  async getActiveByEmailOrMobile(emailOrMobile: string) {
    return await this._findActiveBuilder()
      .andWhere('(user.email = :eom OR user.mobile = :eom)', {
        eom: emailOrMobile,
      })
      .getOne();
  }

  /**
   * -------------------------------------------------------
   */
  async getByMobile(mobile: string) {
    return await this.userRepository.findOne({ mobile });
  }

  /**
   * -------------------------------------------------------
   */
  async findActiveById(userId: number) {
    const data = await this._findActiveBuilder()
      .andWhere({ id: userId })
      .getOne();

    return data;
  }

  /**
   * -------------------------------------------------------
   */
  async getById(id: number) {
    const builder = this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.firstName',
        'user.lastName',
        'user.mobile',
        'user.role',
        'user.status',
      ])
      .where({ id });

    const user = await builder.getOne();
    if (!user) {
      this.error.unprocessableEntity(['t.The user was not found']);
    }

    return {
      ...user,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
    };
  }

  /**
   * -------------------------------------------------------
   */
  async add(dto: CreateUserDto) {
    const newUser = new UserEntity();
    for (const key in dto) {
      newUser[key] = dto[key];
    }

    newUser.createdAt = new Date();

    const { identifiers } = await this.userRepository
      .createQueryBuilder()
      .insert()
      .values(newUser)
      .execute();

    const newUserId = identifiers[0].id;
    const user = await this.userRepository.findOne(newUserId);

    return {
      id: user.id,
      email: user.email,
      mobile: user.mobile,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
    };
  }

  /**
   * -------------------------------------------------------
   */
  async updateUser(id: number, data: any) {
    const user = await this.userRepository.findOne(id);

    delete data?.id;
    Object.keys(data).forEach((field) => {
      user[field] = data[field];
    });
    console.log({ ...user }, data);

    await user.save();
  }

  /**
   * -------------------------------------------------------
   */
  async changePassword(id: number, oldPassword: string, newPassword: string) {
    const user = await this.userRepository.findOne(id);

    if (oldPassword && !(await user.isCorrectSaltPassword(oldPassword))) {
      this.error.unprocessableEntity(['t.The current password is incorrect']);
    }

    user.password = newPassword;
    await user.save();

    return user;
  }

  /**
   * -------------------------------------------------------
   */
  async resetPasswordByToken(token: string, newPassword: string) {
    const user = await this.findByValidHashCode(token);

    if (!user) {
      throw this.error.unprocessableEntity([
        't.There is an invalid or expired link to reset your password!',
      ]);
    }

    user.randomHash = null;
    user.expireRandomHash = null;
    user.password = newPassword;
    await user.save();

    return user;
  }

  /**
   * -------------------------------------------------------
   */
  async findByValidHashCode(randomHash: string, email = null, mobile = null) {
    const where = { randomHash, status: UserStatus.active } as any;

    if (mobile) {
      where.mobile = mobile;
    }
    if (email) {
      where.email = email;
    }

    const user = await this.userRepository.findOne(where);
    if (user && moment(user.expireRandomHash).isAfter(moment())) {
      return user;
    }
    return false;
  }

  // /**
  //  * -------------------------------------------------------
  //  */
  // async deleteUser(id: number) {
  //   return await this.userRepository
  //     .createQueryBuilder()
  //     .update()
  //     .set({ isDeleted: true })
  //     .where({ id })
  //     .execute();
  // }

  /**
   * -------------------------------------------------------
   */
  private _findActiveBuilder() {
    return this.userRepository
      .createQueryBuilder('user')
      .andWhere({ status: UserStatus.active });
  }

  /**
   * -------------------------------------------------------
   */
  async findActiveUserByMobileOrEmail(emailOrMobile) {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .andWhere('(user.email = :eom OR user.mobile = :eom)', {
        eom: emailOrMobile,
      })
      .andWhere({ status: UserStatus.active })
      .getOne();

    if (!user) {
      this.error.unprocessableEntity(['t.The user was not found!']);
    }

    return user;
  }
}
