import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { successfulResult } from '../../utils';
import { multerOptions } from '../../utils/multer.options';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserRoles } from '../user/entities/user.entity';
import { UpsertStorefrontHomeDto } from './dto/upsert-storefront-home.dto';
import { StorefrontHomeService } from './storefront-home.service';

@ApiTags('Storefront Home')
@Controller('storefront/home')
export class StorefrontHomeController {
  constructor(private readonly homeService: StorefrontHomeService) {}

  /**
   * GET /storefront/home
   * Public presentation contract for storefront-next Home.
   */
  @Get()
  async getPublic() {
    const data = await this.homeService.getPublicHome();
    return successfulResult([], data);
  }

  /**
   * GET /storefront/home/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async getAdmin() {
    const data = await this.homeService.getAdminHome();
    return successfulResult([], data);
  }

  /**
   * PUT /storefront/home/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  async upsertAdmin(@Body() dto: UpsertStorefrontHomeDto) {
    const data = await this.homeService.upsertAdminHome(dto.sections);
    return successfulResult(['پیکربندی صفحه اصلی ذخیره شد'], data);
  }

  /**
   * POST /storefront/home/image/admin
   */
  @Post('image/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', multerOptions('home')))
  async uploadImage(@UploadedFile() file) {
    const data = await this.homeService.saveUploadedImage(file);
    return successfulResult(['تصویر آپلود شد'], data);
  }
}
