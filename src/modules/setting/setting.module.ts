import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingEntity } from './entities/setting.entity';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';
import { CapabilityModule } from '../auth/capability/capability.module';

@Module({
  imports: [TypeOrmModule.forFeature([SettingEntity]), CapabilityModule],
  controllers: [SettingController],
  providers: [SettingService],
  exports: [SettingService],
})
export class SettingModule {}
