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
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IncredibleOfferService } from './Incredible-offer.service';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { Roles } from '../auth/role/role.decorator';
import { UserEntity, UserRoles } from '../user/entities/user.entity';
import { CreateIncredibleOfferDto } from './dto/create-incredible-offer.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerOptions } from '../../utils/multer.options';
import { UpdateIncredibleOfferDto } from './dto/update-incredible-offer.dto';
import { Page } from '../../utils/decorators/page.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { Filter } from '../../utils/decorators/filter.decorator';
import { DeleteIncredibleOfferDto } from './dto/delete-incredible-offer.dto';
import { IncredibleOfferImportExcelDto } from './dto/incredible-offer-import-excel.dto';
import { ErrorService } from '../../error/error.service';
import { User } from '../../utils/decorators/user.decorator';
import { successfulResult } from '../../utils';

@ApiTags('Incredible Offer')
@Controller('incredible-offers')
export class IncredibleOffersController {
  constructor(
    private incredibleOfferService: IncredibleOfferService,
    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * POST /incredible-offers/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  async add(@Body() dto: CreateIncredibleOfferDto, @User() user: UserEntity) {
    const newOffer = await this.incredibleOfferService.add(dto, user);

    return successfulResult(['t.The offer is created successfully'], newOffer);
  }

  /**
   * -------------------------------------------------------
   * POST /incredible-offers/import/excel/admin
   */
  @Post('/import/excel/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', multerOptions('temp', ['xlsx', 'xls'])),
  )
  async importExcel(
    @Body() dto: IncredibleOfferImportExcelDto,
    @UploadedFile() file,
    @User() user: UserEntity,
  ) {
    const results = await this.incredibleOfferService.importExcel(dto, file);

    const successCount = results.filter((result) => result.success).length;
    if (successCount === 0) {
      this.error.unprocessableEntity(
        ['t.There was an error importing the incredible offers list'],
        results,
      );
    }

    let message =
      'Part of the list of special offers has been successfully imported';
    if (results.length === successCount) {
      message = 'The list of special offers has been successfully imported';
    }

    return successfulResult([`t.${message}`], results);
  }

  /**
   * -------------------------------------------------------
   * PUT /incredible-offers/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async update(
    @Body() dto: UpdateIncredibleOfferDto,
    @User() user: UserEntity,
  ) {
    await this.incredibleOfferService.update(dto);

    return successfulResult(['t.The offer is updated successfully']);
  }

  /**
   * -------------------------------------------------------
   * GET /incredible-offers/:id/admin
   */
  @Get(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getById(@Param('id') offerId: number) {
    const data = await this.incredibleOfferService.getById(offerId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /incredible-offers/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'product_id', required: false })
  @ApiQuery({
    name: 'from_date',
    required: false,
    description: 'e.g. gte:2022-04-16[and]lte:2022-04-16',
  })
  @ApiQuery({
    name: 'to_date',
    required: false,
    description: 'e.g. gte:2022-04-16[and]lte:2022-04-16',
  })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter([
      ['product_id', 'productId'],
      ['from_date', 'fromDate', 'DATE'],
      ['to_date', 'toDate', 'DATE'],
    ])
    filters,
  ) {
    const list = await this.incredibleOfferService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /incredible-offers
   */
  @Get()
  @ApiQuery({ name: 'show_random', required: false })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAll(@Page() page, @Limit() limit, @Query('show_random') showRandom) {
    const list = await this.incredibleOfferService.getAll(
      page,
      limit,
      showRandom === '1',
    );
    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * DELETE /incredible-offers/admin
   */
  @Delete('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async delete(
    @Body() dto: DeleteIncredibleOfferDto,
    @User() user: UserEntity,
  ) {
    const data = await this.incredibleOfferService.delete(dto);
    return successfulResult(['t.The offers are deleted successfully'], data);
  }
}
