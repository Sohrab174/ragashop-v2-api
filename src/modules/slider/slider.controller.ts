import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import * as dotenv from 'dotenv';
import { ErrorService } from '../../error/error.service';
import { Languages } from '../../global.interfaces';
import { successfulResult } from '../../utils';
import { Filter } from '../../utils/decorators/filter.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Page } from '../../utils/decorators/page.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { multerOptions } from '../../utils/multer.options';
import { sort } from '../../utils/sort';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserRoles } from '../user/entities/user.entity';
import { CreateSliderDto } from './dto/create-slider.dto';
import { SliderSortDto } from './dto/slider-sort.dto';
import {
  SliderEntity,
  SliderPositions,
  SliderType,
} from './entities/slider.entity';
import { SliderService } from './slider.service';
import { UpdateSliderDto } from './dto/update-slider.dto';
dotenv.config();

@ApiTags('Slider')
@Controller('sliders')
export class SliderController {
  constructor(
    private sliderService: SliderService,
    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * POST /sliders/photo/admin
   */
  @Post('photo/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', multerOptions('sliders')))
  async addPhotoSlider(@Body() dto: CreateSliderDto, @UploadedFile() file) {
    const filePath = await this.sliderService.addSlider(
      dto,
      file,
      SliderType.photo,
    );

    return successfulResult(['The slider is uploaded successfully'], filePath);
  }

  /**
   * -------------------------------------------------------
   * PUT /sliders/photo/admin
   */
  @Put('photo/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', multerOptions('sliders')))
  async updatePhotoSlider(@Body() dto: UpdateSliderDto, @UploadedFile() file) {
    await this.sliderService.updateSlider(dto, SliderType.photo, file);

    return successfulResult(['The slider is updated successfully']);
  }

  /**
   * -------------------------------------------------------
   * POST /sliders/video/admin
   */
  @Post('video/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor(
      'file',
      multerOptions(
        'sliders',
        ['mp4', 'mkv', 'avi', 'wmv'],
        process.env.MAX_VIDEO_FILE_SIZE,
      ),
    ),
  )
  async addVideoSlider(@Body() dto: CreateSliderDto, @UploadedFile() file) {
    const filePath = await this.sliderService.addSlider(
      dto,
      file,
      SliderType.video,
    );

    return successfulResult(['The slider is uploaded successfully'], filePath);
  }

  /**
   * -------------------------------------------------------
   * PUT /sliders/video/admin
   */
  @Put('video/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor(
      'file',
      multerOptions(
        'sliders',
        ['mp4', 'mkv', 'avi', 'wmv'],
        process.env.MAX_VIDEO_FILE_SIZE,
      ),
    ),
  )
  async updateVideoSlider(@Body() dto: UpdateSliderDto, @UploadedFile() file) {
    await this.sliderService.updateSlider(dto, SliderType.video, file);

    return successfulResult(['The slider is updated successfully']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /sliders/:id/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async deleteSlider(@Param('id') sliderId: number) {
    await this.sliderService.deleteSlider(sliderId);

    return successfulResult(['The slider is deleted']);
  }

  /**
   * -------------------------------------------------------
   * GET /sliders/positions/admin
   */
  @Get('positions/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getPositions() {
    const list = await this.sliderService.getPositions();

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /sliders/:id/admin
   */
  @Get(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getSliderById(@Param('id') sliderId: number) {
    const data = await this.sliderService.getSliderById(sliderId);

    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /sliders/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'language', required: false, enum: Languages })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllSliders(@Page() page, @Limit() limit, @Sort() sorts) {
    const list = await this.sliderService.getAllSliders(page, limit, sorts);

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /sliders
   */
  @Get()
  @UseGuards()
  @ApiQuery({ name: 'position', required: false, enum: SliderPositions })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAll(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['position'])
    filters,
  ) {
    const list = await this.sliderService.getAll(page, limit, filters, sorts);

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * PUT /sliders/sort/admin
   */
  @Put('sort/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async sort(@Body() dto: SliderSortDto) {
    const result = await sort(SliderEntity.name, dto.id, dto.action);

    if (!result) {
      return this.error.unprocessableEntity(['Replacement slider not found']);
    }

    return successfulResult(['The slider was sorted successfully']);
  }
}
