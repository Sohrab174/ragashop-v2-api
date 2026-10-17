import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
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
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { RequireCapabilities } from '../auth/capability/capability.decorator';
import { UserCapabilityName } from '../auth/capability/capability.catalog';
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
   * GET /storefront/home/preview/:token
   * Unpublished preview. Requires a redeemed preview-only credential.
   * Admin JWTs are not accepted. Token alone is never enough.
   * Never reads or writes published rows. Do not log the credential.
   */
  @Get('preview/:token')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  async getPreview(
    @Param('token') token: string,
    @Headers('x-home-preview-credential') credential?: string,
  ) {
    const data = this.homeService.getHomePreviewSession(
      token,
      String(credential || ''),
    );
    return successfulResult([], data);
  }

  /**
   * POST /storefront/home/preview/:token/redeem
   * One-time handoff. Does not return homepage content and does not accept Admin JWTs.
   */
  @Post('preview/:token/redeem')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  async redeemPreview(
    @Param('token') token: string,
    @Headers('x-home-preview-credential') credential?: string,
    @Body() body?: { nonce?: string },
  ) {
    this.homeService.redeemHomePreviewHandoff(
      token,
      String(credential || ''),
      String(body?.nonce || ''),
    );
    return successfulResult([], { ok: true });
  }

  /**
   * POST /storefront/home/admin/preview-session
   * Maps unsaved Admin sections with the public mapper; stores result in memory only.
   */
  @Post('admin/preview-session')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.storefront_home_read)
  async createPreviewSession(
    @Req() req: { user?: { id?: number } },
    @Body() dto: UpsertStorefrontHomeDto,
  ) {
    const data = await this.homeService.createHomePreviewSession(
      dto.sections,
      Number(req?.user?.id),
    );
    return successfulResult([], data);
  }

  /**
   * GET /storefront/home/admin/product-eligibility?ids=1,2
   * Read-only. Same product set as the current public homepage mapper.
   */
  @Get('admin/product-eligibility')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.storefront_home_read)
  async getProductEligibility(@Query('ids') ids?: string) {
    const data = await this.homeService.findPublicHomepageEligibleProductIds(ids);
    return successfulResult([], data);
  }

  /**
   * GET /storefront/home/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.storefront_home_read)
  async getAdmin() {
    const data = await this.homeService.getAdminHome();
    return successfulResult([], data);
  }

  /**
   * PUT /storefront/home/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.storefront_home_manage)
  async upsertAdmin(@Body() dto: UpsertStorefrontHomeDto) {
    const data = await this.homeService.upsertAdminHome(dto.sections);
    return successfulResult(['پیکربندی صفحه اصلی ذخیره شد'], data);
  }

  /**
   * POST /storefront/home/image/admin
   */
  @Post('image/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.storefront_home_manage)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', multerOptions('home')))
  async uploadImage(@UploadedFile() file) {
    const data = await this.homeService.saveUploadedImage(file);
    return successfulResult(['تصویر آپلود شد'], data);
  }
}
