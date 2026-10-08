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
import { UserCapabilityService } from '../manual-payment/user-capability.service';

export type StaffActor = { id: number; role: UserRoles | string };

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,

    private error: ErrorService,
    private mail: MailService,
    private capabilityService: UserCapabilityService,
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

    // Soft-deleted staff must not appear as active employees.
    builder.andWhere('user.isDeleted = :isDeleted', { isDeleted: false });

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('user.createdAt', 'DESC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
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
    return await this._findActiveBuilder()
      .andWhere({ id: userId })
      .getOne();
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
        'user.isDeleted',
      ])
      .where({ id });

    const user = await builder.getOne();
    if (!user || user.isDeleted) {
      this.error.unprocessableEntity(['کاربر موردنظر یافت نشد']);
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      mobile: user.mobile,
      role: user.role,
      status: user.status,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
    };
  }

  /**
   * -------------------------------------------------------
   */
  async add(dto: CreateUserDto, actor?: StaffActor) {
    this.assertActorMayAssignRole(actor, dto.role);

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
  async updateUser(id: number, data: any, actor?: StaffActor) {
    const user = await this.userRepository.findOne(id);
    if (!user || user.isDeleted) {
      this.error.unprocessableEntity(['کاربر موردنظر یافت نشد']);
    }

    this.assertActorMayManageTarget(actor, user);
    if (data.role !== undefined) {
      this.assertActorMayAssignRole(actor, data.role);
    }

    const nextRole = data.role !== undefined ? data.role : user.role;
    const nextStatus =
      data.status !== undefined ? data.status : user.status;

    await this.assertNotBreakingLastAdmin(user, {
      nextRole,
      nextStatus,
      softDeleting: false,
    });

    delete data?.id;
    Object.keys(data).forEach((field) => {
      user[field] = data[field];
    });

    await user.save();
  }

  /**
   * -------------------------------------------------------
   */
  async changePassword(id: number, oldPassword: string, newPassword: string) {
    const user = await this.userRepository.findOne(id);

    if (oldPassword && !(await user.isCorrectSaltPassword(oldPassword))) {
      this.error.unprocessableEntity(['کلمه عبور فعلی اشتباه است']);
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
        'لینک تغییر پسورد نامعتبر یا منقضی شده است',
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

  /**
   * -------------------------------------------------------
   */
  async deleteUser(id: number, adminUserId: number, actor?: StaffActor) {
    if (+id === adminUserId) {
      this.error.methodNotAllowed(['امکان حذف حساب کاربری خود وجود ندارد!']);
    }

    const user = await this.userRepository.findOne(id);
    if (!user || user.isDeleted) {
      this.error.unprocessableEntity(['کاربر موردنظر یافت نشد']);
    }

    this.assertActorMayManageTarget(actor, user);

    await this.assertNotBreakingLastAdmin(user, {
      nextRole: user.role,
      nextStatus: UserStatus.inactive,
      softDeleting: true,
    });

    return await this.userRepository
      .createQueryBuilder()
      .update()
      .set({ isDeleted: true })
      .where({ id })
      .execute();
  }

  /**
   * -------------------------------------------------------
   */
  async getCapabilitiesForAdmin(userId: number) {
    const user = await this.requireAssignableEmployee(userId);
    const capabilities = await this.capabilityService.listEffectiveCodes(user);
    return {
      userId: user.id,
      role: user.role,
      capabilities,
      note: 'employee_explicit',
    };
  }

  async replaceCapabilitiesForAdmin(userId: number, capabilities: string[]) {
    await this.requireAssignableEmployee(userId);
    return this.capabilityService.replaceAll(userId, capabilities);
  }

  private async requireAssignableEmployee(userId: number) {
    const user = await this.userRepository.findOne(userId);
    if (!user || user.isDeleted) {
      this.error.unprocessableEntity(['کاربر موردنظر یافت نشد']);
    }
    if (user.role === UserRoles.admin) {
      this.error.methodNotAllowed([
        'دسترسی مدیر کامل است و از طریق چک‌لیست کارمند تنظیم نمی‌شود',
      ]);
    }
    if (user.role !== UserRoles.employee) {
      this.error.unprocessableEntity(['فقط برای کارمندان قابل تنظیم است']);
    }
    return user;
  }

  /**
   * Non-admin staff (even with employee.manage) may only work with employee
   * accounts and may only assign the employee role. Callers without an actor
   * (internal/legacy paths) keep previous behavior.
   */
  private assertActorMayAssignRole(
    actor: StaffActor | undefined,
    role: UserRoles | string | undefined,
  ) {
    if (!actor || actor.role === UserRoles.admin) {
      return;
    }
    if (role !== UserRoles.employee) {
      this.error.forbidden([
        'فقط مدیر می‌تواند نقش مدیر را ایجاد یا اعطا کند',
      ]);
    }
  }

  private assertActorMayManageTarget(
    actor: StaffActor | undefined,
    target: UserEntity,
  ) {
    if (!actor || actor.role === UserRoles.admin) {
      return;
    }
    if (target.role !== UserRoles.employee) {
      this.error.forbidden([
        'شما دسترسی لازم برای مدیریت حساب مدیر را ندارید',
      ]);
    }
  }

  private async assertNotBreakingLastAdmin(
    user: UserEntity,
    opts: {
      nextRole: UserRoles | string;
      nextStatus: UserStatus | string;
      softDeleting: boolean;
    },
  ) {
    if (user.role !== UserRoles.admin) {
      return;
    }

    const losingAdminRole =
      opts.softDeleting ||
      opts.nextRole !== UserRoles.admin ||
      opts.nextStatus !== UserStatus.active;

    if (!losingAdminRole) {
      return;
    }

    const activeAdmins = await this.userRepository
      .createQueryBuilder('user')
      .where({
        role: UserRoles.admin,
        status: UserStatus.active,
        isDeleted: false,
      })
      .getCount();

    if (activeAdmins <= 1) {
      this.error.methodNotAllowed([
        'امکان غیرفعال‌سازی، حذف یا تنزل آخرین مدیر فعال وجود ندارد',
      ]);
    }
  }

  private _findActiveBuilder() {
    return this.userRepository
      .createQueryBuilder('user')
      .andWhere({ status: UserStatus.active, isDeleted: false });
  }

  async findActiveUserByMobileOrEmail(emailOrMobile) {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .andWhere('(user.email = :eom OR user.mobile = :eom)', {
        eom: emailOrMobile,
      })
      .andWhere({ status: UserStatus.active, isDeleted: false })
      .getOne();

    if (!user) {
      this.error.unprocessableEntity(['کاربر موردنظر یافت نشد']);
    }

    return user;
  }
}
