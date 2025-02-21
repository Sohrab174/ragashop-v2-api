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
