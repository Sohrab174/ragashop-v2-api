import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GatewayEntity } from './entities/gateway.entity';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { SettingEntity } from '../setting/entities/setting.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GatewayEntity, SettingEntity])],
  controllers: [GatewayController],
  providers: [GatewayService],
  exports: [GatewayService],
})
export class GatewayModule {}
