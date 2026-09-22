import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserCapabilityEntity } from './entities/user-capability.entity';
import { UserCapabilityName } from './manual-payment.types';
import { UserRoles } from '../user/entities/user.entity';

@Injectable()
export class UserCapabilityService {
  constructor(
    @InjectRepository(UserCapabilityEntity)
    private readonly capabilityRepository: Repository<UserCapabilityEntity>,
  ) {}

  /**
   * Admin always allowed. Employee needs explicit user_capability rows.
   */
  async userHasCapability(
    user: { id: number; role: UserRoles | string },
    capability: UserCapabilityName | string,
  ): Promise<boolean> {
    if (user.role === UserRoles.admin) {
      return true;
    }
    const row = await this.capabilityRepository.findOne({
      where: { userId: user.id, capability },
    });
    return !!row;
  }

  async assertUserHasCapability(
    user: { id: number; role: UserRoles | string },
    capability: UserCapabilityName | string,
    errorService: { forbidden: () => never },
  ): Promise<void> {
    const ok = await this.userHasCapability(user, capability);
    if (!ok) {
      errorService.forbidden();
    }
  }

  async grant(
    userId: number,
    capability: UserCapabilityName | string,
  ): Promise<void> {
    const existing = await this.capabilityRepository.findOne({
      where: { userId, capability },
    });
    if (existing) {
      return;
    }
    await this.capabilityRepository
      .createQueryBuilder()
      .insert()
      .values({
        userId,
        capability,
        createdAt: new Date(),
      })
      .execute();
  }

  async listForUser(userId: number): Promise<UserCapabilityEntity[]> {
    return this.capabilityRepository.find({ where: { userId } });
  }
}
