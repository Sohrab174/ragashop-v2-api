import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NavMenuController } from './nav-menu.controller';
import { NavMenuService } from './nav-menu.service';
import { NavMenuEntity } from './entities/nav-menu.entity';

@Module({
  imports: [TypeOrmModule.forFeature([NavMenuEntity])],
  controllers: [NavMenuController],
  providers: [NavMenuService],
  exports: [NavMenuService],
})
export class NavMenuModule {}
