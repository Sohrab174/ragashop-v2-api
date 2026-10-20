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
import {
  PublishHomeArrangementDto,
  UpsertStorefrontHomeDto,
} from './dto/upsert-storefront-home.dto';
import { StorefrontHomeService } from './storefront-home.service';
import {
  assertHomeMasterBodyFields,
  homeMasterMulterOptions,
} from './home-master-multer';

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
      dto.instances,
    );
    return successfulResult([], data);
  }

  /**
   * PUT /storefront/home/admin/preview-session/:token
   * Updates the unpublished payload for the current iframe. Does not publish.
   */
  @Put('admin/preview-session/:token')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.storefront_home_read)
  async replacePreviewSession(
    @Req() req: { user?: { id?: number } },
    @Param('token') token: string,
    @Body() dto: UpsertStorefrontHomeDto,
  ) {
    const data = await this.homeService.replaceHomePreviewSession(
      token,
      dto.sections,
      Number(req?.user?.id),
      dto.instances,
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
   * GET /storefront/home/admin/image-retention-report
   * Dry-run only — never deletes. Lists referenced vs candidate orphan files.
   */
  @Get('admin/image-retention-report')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.storefront_home_manage)
  async imageRetentionReport() {
    const data = await this.homeService.reportHomeImageRetentionDryRun();
    return successfulResult(['گزارش نگهداری تصویر (فقط گزارش، بدون حذف)'], data);
  }

  /**
   * PUT /storefront/home/admin/arrangement
   * Arrangement-only replace. The Admin publish button uses PUT /admin so
   * sections and instances commit together.
   */
  @Put('admin/arrangement')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.storefront_home_manage)
  async publishArrangement(@Body() dto: PublishHomeArrangementDto) {
    const data = await this.homeService.publishHomeArrangement(dto.instances);
    return successfulResult(['چیدمان صفحه اصلی ذخیره شد'], data);
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
    const data = await this.homeService.upsertAdminHome(dto.sections, dto.instances);
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

  /**
   * POST /storefront/home/image/admin/master
   * One source image → retained master + desktop/mobile(+wide) Concept D WebP.
   * Higher size / multipart field limits apply only here (legacy stays at 1 MB).
   *
   * multipart fields:
   * - file (required)
   * - profile: hero | category | pets (default hero)
   * - focusDesktopX / focusDesktopY / focusMobileX / focusMobileY (0–100)
   */
  @Post('image/admin/master')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.storefront_home_manage)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', homeMasterMulterOptions()))
  async uploadMasterImage(
    @UploadedFile() file,
    @Body()
    body: {
      profile?: string;
      focusDesktopX?: string;
      focusDesktopY?: string;
      focusMobileX?: string;
      focusMobileY?: string;
    },
  ) {
    assertHomeMasterBodyFields(body as Record<string, unknown>);
    const data = await this.homeService.saveMasterUploadedImage(file, body || {});
    return successfulResult(['تصویر اصلی پردازش شد'], data);
  }

  /**
   * POST /storefront/home/image/admin/recrop
   * Re-generate desktop/mobile(+wide) WebP from a retained master (no re-upload).
   * JSON body — no multipart.
   */
  @Post('image/admin/recrop')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.storefront_home_manage)
  async recropMasterImage(
    @Body()
    body: {
      masterPath?: string;
      profile?: string;
      focusDesktopX?: string | number;
      focusDesktopY?: string | number;
      focusMobileX?: string | number;
      focusMobileY?: string | number;
      focusMobileWideX?: string | number;
      focusMobileWideY?: string | number;
    },
  ) {
    const data = await this.homeService.recropMasterImage(body || {});
    return successfulResult(['برش تصویر اعمال شد'], data);
  }
}
