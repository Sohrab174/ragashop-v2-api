import {
  Controller,
  Get,
  Param,
  Res,
  Req,
  Post,
  UseGuards,
  UseInterceptors,
  Body,
  UploadedFile,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorService } from '../../error/error.service';
import { Languages } from '../../global.interfaces';
import { successfulResult } from '../../utils';
import { Roles } from '../auth/role/role.decorator';
import { UserRoles } from '../user/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerOptions } from '../../utils/multer.options';
import { UploadCkeditorDto } from './dto/upload-ckeditor.dto';
import { CommonService } from './common.service';
import { ConfigurationService } from '../../config/configuration.service';

@ApiTags('Common')
@Controller()
export class CommonController {
  constructor(
    private error: ErrorService,
    private config: ConfigurationService,
    private commonService: CommonService,
  ) {}

  /**
   * -------------------------------------------------------
   */
  @Get('ping')
  async getPing() {
    return 'pong';
  }

  /**
   * -------------------------------------------------------
   */
  @Get('manifest.json')
  async generateManifest(@Query('token') token: string) {
    return await this.commonService.generateManifest(token);
  }

  /**
   * -------------------------------------------------------
   */
  @Get('language')
  @ApiHeader({
    name: 'x-custom-lang',
    required: true,
    enum: Languages,
    schema: { default: Languages.fa },
  })
  async getLanguage(@Req() req) {
    console.log(req.lang);

    // this.error.methodNotAllowed([('پیام ارسال شد')]);
    return successfulResult(['پیام ارسال شد']);
  }

  /**
   * -------------------------------------------------------
   */
  @Get('static/:path/:filename')
  seeUploadedFile(
    @Param('path') path: string,
    @Param('filename') filename: string,
    @Res() res,
  ) {
    if (path === 'file') {
      return this.error.methodNotAllowed();
    }

    // Retained masters are private (Admin recrop only) — never serve publicly.
    if (path === 'home-masters' || String(path || '').includes('..')) {
      return this.error.notFound(['فایل پیدا نشد']);
    }

    // Homepage uploads: only raster extensions; never execute as active content.
    if (path === 'home') {
      const safeName = String(filename || '');
      if (
        !/^[a-zA-Z0-9._-]+$/.test(safeName) ||
        safeName.includes('..') ||
        safeName.includes('/') ||
        safeName.includes('\\')
      ) {
        return this.error.notFound(['فایل پیدا نشد']);
      }
      const ext = safeName.split('.').pop()?.toLowerCase();
      const mimeByExt: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
      };
      const mime = ext ? mimeByExt[ext] : undefined;
      if (!mime) {
        return this.error.notFound(['فایل پیدا نشد']);
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.type(mime);
    }

    return res.sendFile(`${path}/${filename}`, { root: './uploads' });
  }

  /**
   * -------------------------------------------------------
   * POST /upload/ckeditor
   */
  @Post('/upload/ckeditor')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('upload', multerOptions('ckeditor')))
  async updateIcon(@Body() dto: UploadCkeditorDto, @UploadedFile() upload) {
    const path = await this.commonService.ckeditorUploader(upload);

    return {
      uploaded: 1,
      fileName: upload.filename,
      url: `${this.config.app.apiBaseUrl}/static${path}`,
    };
  }
}
