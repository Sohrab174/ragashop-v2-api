import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Delete,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';

import { successfulResult } from '../../utils';
import { User } from '../../utils/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserRoles } from '../user/entities/user.entity';

import { Headers } from '../../utils/decorators/header.decorator';

import { ErrorService } from '../../error/error.service';
import { GatewayService } from './gateway.service';
import {
  GatewayEntity,
  GatewayNames,
  GatewayStatus,
} from './entities/gateway.entity';
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { I18n } from 'nestjs-i18n';
import { CreateGatewayDto } from './dto/create-gateway.dto';
import { UpdateGatewayDto } from './dto/update-gateway.dto';
import { Company } from '../../utils/decorators/company.decorator';
import { sort } from '../../utils/sort';
import { GatewaySortDto } from './dto/gateway-sort.dto';

@ApiTags('Gateway')
@Headers()
@Controller('gateways')
export class GatewayController {
  constructor(
    private gatewayService: GatewayService,
    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /gateways/availabilities/admin
   */
  @Get('availabilities/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getAvailabilities() {
    return successfulResult([], Object.values(GatewayNames));
  }

  /**
   * -------------------------------------------------------
   * GET /gateways/:id/admin
   */
  @Get(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getById(@Param('id') gatewayId: number, @User('companyId') companyId) {
    const data = await this.gatewayService.getById(gatewayId, companyId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /gateways/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'company_id', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'status', required: false, enum: GatewayStatus })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['status', ['company_id', 'companyId'], 'name'])
    filters,
    @User('companyId') companyId,
  ) {
    const list = await this.gatewayService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
      companyId,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /gateways
   */
  @Get()
  async getAll(@Company('id') companyId) {
    const list = await this.gatewayService.getAll(companyId);
    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * POST /gateways/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  async add(@Body() dto: CreateGatewayDto, @I18n() i18n) {
    const newGateway = await this.gatewayService.add(dto);

    return successfulResult(
      [i18n.t('t.The gateway is created successfully')],
      newGateway,
    );
  }

  /**
   * -------------------------------------------------------
   * PUT /gateways/sort/admin
   */
  @Put('sort/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async sort(@Body() dto: GatewaySortDto, @I18n() i18n) {
    const result = await sort(GatewayEntity.name, dto.id, dto.action);

    if (!result) {
      return this.error.unprocessableEntity([
        i18n.t('t.Replacement gateway not found'),
      ]);
    }

    return successfulResult([i18n.t('t.The gateway was sorted successfully')]);
  }

  /**
   * -------------------------------------------------------
   * PUT /gateways/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async update(
    @Body() dto: UpdateGatewayDto,
    @User('companyId') companyId,
    @I18n() i18n,
  ) {
    await this.gatewayService.update(dto, companyId);

    return successfulResult([i18n.t('t.The gateway is updated successfully')]);
  }

  /**
   * -------------------------------------------------------
   * DELETE /gateways/:id/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async delete(
    @Param('id') gatewayId: number,
    @User('companyId') companyId,
    @I18n() i18n,
  ) {
    await this.gatewayService.delete(gatewayId, companyId);

    return successfulResult([i18n.t('t.The gateway is deleted')]);
  }
}
