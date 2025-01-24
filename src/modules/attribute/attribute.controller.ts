import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ErrorService } from '../../error/error.service';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AttributeService } from './attribute.service';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { Roles } from '../auth/role/role.decorator';
import { UserRoles } from '../user/entities/user.entity';
import { User } from '../../utils/decorators/user.decorator';
import { successfulResult } from '../../utils';
import { AttributeTypes } from './entities/attribute.entity';
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { I18n } from 'nestjs-i18n';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';
import { CreateAttributeValueDto } from './dto/create-attribute-value.dto';
import { UpdateAttributeValueDto } from './dto/update-attribute-value.dto';

@ApiTags('Attribute')
@Controller('attributes')
export class AttributeController {
  constructor(
    private attributeService: AttributeService,
    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /attributes/values/admin
   */
  @Get('values/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'attribute_id', required: false })
  @ApiQuery({ name: 'value', required: false })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllValuesForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter([['attribute_id', 'attributeId'], ['value']])
    filters,
  ) {
    const list = await this.attributeService.getAllValuesForAdmin(
      page,
      limit,
      filters,
      sorts,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /attributes/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'type', required: false, enum: AttributeTypes })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['type', ['name']])
    filters,
  ) {
    const list = await this.attributeService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /attributes/:id/admin
   */
  @Get(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async getByIdForAdmin(@Param('id') attributeId: number) {
    const data = await this.attributeService.getByIdForAdmin(attributeId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * POST /attributes/value/admin
   */
  @Post('value/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  async addValue(@Body() dto: CreateAttributeValueDto, @I18n() i18n) {
    const newValue = await this.attributeService.addValue(dto);

    return successfulResult(
      [i18n.t('t.The attribute value is created successfully')],
      newValue,
    );
  }

  /**
   * -------------------------------------------------------
   * POST /attributes/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  async add(@Body() dto: CreateAttributeDto, @I18n() i18n) {
    const newAttribute = await this.attributeService.add(dto);

    return successfulResult(
      [i18n.t('t.The attribute is created successfully')],
      newAttribute,
    );
  }

  /**
   * -------------------------------------------------------
   * PUT /attributes/value/admin
   */
  @Put('value/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async updateValues(@Body() dto: UpdateAttributeValueDto, @I18n() i18n) {
    await this.attributeService.updateValue(dto);

    return successfulResult([
      i18n.t('t.The attribute value is updated successfully'),
    ]);
  }

  /**
   * -------------------------------------------------------
   * PUT /attributes/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async update(@Body() dto: UpdateAttributeDto, @I18n() i18n) {
    await this.attributeService.update(dto);

    return successfulResult([
      i18n.t('t.The attribute is updated successfully'),
    ]);
  }

  /**
   * -------------------------------------------------------
   * DELETE /attributes/value/:id/admin
   */
  @Delete('value/:id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async deleteValue(@Param('id') attributeValueId: number, @I18n() i18n) {
    await this.attributeService.deleteValue(attributeValueId);

    return successfulResult([i18n.t('t.The attribute value is deleted')]);
  }

  /**
   * -------------------------------------------------------
   * DELETE /attributes/:id/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async delete(@Param('id') attributeId: number, @I18n() i18n) {
    await this.attributeService.delete(attributeId);

    return successfulResult([i18n.t('t.The attribute is deleted')]);
  }
}
