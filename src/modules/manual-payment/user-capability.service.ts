import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserCapabilityEntity } from './entities/user-capability.entity';
import {
  ALL_USER_CAPABILITIES,
  UserCapabilityName,
  capabilitySatisfiers,
  isKnownCapability,
} from '../auth/capability/capability.catalog';
import { UserRoles } from '../user/entities/user.entity';
import { ErrorService } from '../../error/error.service';

@Injectable()
export class UserCapabilityService {
  constructor(
    @InjectRepository(UserCapabilityEntity)
    private readonly capabilityRepository: Repository<UserCapabilityEntity>,
    private readonly error: ErrorService,
  ) {}

  /**
   * Admin always allowed. Employee needs an explicit matching (or alias) row.
   */
  async userHasCapability(
    user: { id: number; role: UserRoles | string },
    capability: UserCapabilityName | string,
  ): Promise<boolean> {
    if (user.role === UserRoles.admin) {
      return true;
    }
    const candidates = capabilitySatisfiers(String(capability));
    const row = await this.capabilityRepository
      .createQueryBuilder('cap')
      .where('cap.userId = :userId', { userId: user.id })
      .andWhere('cap.capability IN (:...candidates)', { candidates })
      .getOne();
    return !!row;
  }

  async assertUserHasCapability(
    user: { id: number; role: UserRoles | string },
    capability: UserCapabilityName | string,
    errorService?: { forbidden: () => never },
  ): Promise<void> {
    const ok = await this.userHasCapability(user, capability);
    if (!ok) {
      (errorService || this.error).forbidden();
    }
  }

  async grant(
    userId: number,
    capability: UserCapabilityName | string,
  ): Promise<void> {
    this.assertKnown(capability);
    const existing = await this.capabilityRepository.findOne({
      where: { userId, capability: String(capability) },
    });
    if (existing) {
      return;
    }
    await this.capabilityRepository
      .createQueryBuilder()
      .insert()
      .values({
        userId,
        capability: String(capability),
        createdAt: new Date(),
      })
      .execute();
  }

  async revoke(
    userId: number,
    capability: UserCapabilityName | string,
  ): Promise<void> {
    this.assertKnown(capability);
    await this.capabilityRepository.delete({
      userId,
      capability: String(capability),
    });
  }

  async listForUser(userId: number): Promise<UserCapabilityEntity[]> {
    return this.capabilityRepository.find({
      where: { userId },
      order: { capability: 'ASC' },
    });
  }

  /**
   * Effective codes for UI/session.
   * Admin receives the full catalog (bypass). Employee receives stored rows only.
   */
  async listEffectiveCodes(user: {
    id: number;
    role: UserRoles | string;
  }): Promise<string[]> {
    if (user.role === UserRoles.admin) {
      return [...ALL_USER_CAPABILITIES];
    }
    const rows = await this.listForUser(user.id);
    return rows.map((r) => String(r.capability)).sort();
  }

  /**
   * Atomic replace of an employee's capability set.
   * Validates catalog membership; de-duplicates; rejects unknown codes.
   */
  async replaceAll(
    userId: number,
    capabilities: string[],
  ): Promise<string[]> {
    if (!Array.isArray(capabilities)) {
      this.error.unprocessableEntity(['لیست دسترسی‌ها نامعتبر است']);
    }

    const unique = [
      ...new Set(
        capabilities
          .map((c) => (typeof c === 'string' ? c.trim() : ''))
          .filter(Boolean),
      ),
    ];

    for (const code of unique) {
      this.assertKnown(code);
    }

    await this.capabilityRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(UserCapabilityEntity);
      await repo.delete({ userId });
      if (!unique.length) {
        return;
      }
      const now = new Date();
      await repo.insert(
        unique.map((capability) => ({
          userId,
          capability,
          createdAt: now,
        })),
      );
    });

    return unique.sort();
  }

  private assertKnown(capability: string | UserCapabilityName): void {
    if (!isKnownCapability(String(capability))) {
      this.error.unprocessableEntity([
        `دسترسی ناشناخته: ${String(capability)}`,
      ]);
    }
  }
}
