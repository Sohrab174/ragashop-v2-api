import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorService } from '../../../error/error.service';
import { UserCapabilityService } from '../../manual-payment/user-capability.service';
import { UserCapabilityName } from '../../manual-payment/manual-payment.types';
import { CAPABILITIES_KEY } from './capability.decorator';

/**
 * Use after JwtAuthGuard + RolesGuard.
 * Admin always passes; employee needs matching user_capability rows.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly capabilityService: UserCapabilityService,
    private readonly error: ErrorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserCapabilityName[]>(
      CAPABILITIES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      this.error.forbidden();
    }

    for (const capability of required) {
      const ok = await this.capabilityService.userHasCapability(
        user,
        capability,
      );
      if (!ok) {
        this.error.forbidden();
      }
    }

    return true;
  }
}
