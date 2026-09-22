import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingEntity } from './entities/setting.entity';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';
import { UserCapabilityEntity } from '../manual-payment/entities/user-capability.entity';
import { UserCapabilityService } from '../manual-payment/user-capability.service';
import { PermissionsGuard } from '../auth/capability/permissions.guard';

@Module({
  imports: [TypeOrmModule.forFeature([SettingEntity, UserCapabilityEntity])],
  controllers: [SettingController],
  providers: [SettingService, UserCapabilityService, PermissionsGuard],
  exports: [SettingService],
})
export class SettingModule {}
