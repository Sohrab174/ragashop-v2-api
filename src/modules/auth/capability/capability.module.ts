import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserCapabilityEntity } from '../../manual-payment/entities/user-capability.entity';
import { UserCapabilityService } from '../../manual-payment/user-capability.service';
import { PermissionsGuard } from './permissions.guard';

/**
 * Standalone capability/RBAC module.
 * Breaks circular imports when feature modules need PermissionsGuard /
 * UserCapabilityService without pulling ManualPayment → Order → Product → …
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserCapabilityEntity])],
  providers: [UserCapabilityService, PermissionsGuard],
  exports: [TypeOrmModule, UserCapabilityService, PermissionsGuard],
})
export class CapabilityModule {}
