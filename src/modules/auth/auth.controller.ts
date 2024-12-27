import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '../../utils/decorators/user.decorator';
import { successfulResult } from '../../utils';
import { AuthService } from './auth.service';
import { AuthLoginDto } from './dto/auth-login.dto';
import { JwtAuthGuard } from './jwt/jwt.guard';
import { AuthUpdateDto } from './dto/auth-update.dto';
import { AuthChangePasswordDto } from './dto/auth-change-password.dto';
import { I18n } from 'nestjs-i18n';
import { AuthForgotDto } from './dto/auth-forgot.dto';
import { AuthResetPasswordDto } from './dto/auth-reset-password.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * --------------------------------------------------------
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: AuthLoginDto, @I18n() i18n) {
    const response = await this.authService.login(dto);
    return successfulResult(
      [i18n.t('t.You have successfully logged in')],
      response,
    );
  }

  /**
   * --------------------------------------------------------
   */
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async me(@User('id') userId: number, @I18n() i18n) {
    const userInfo = await this.authService.getById(userId);
    return successfulResult([i18n.t('t.User information')], userInfo);
  }

  /**
   * --------------------------------------------------------
   */
  @Put('me/password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @User('id') userId: number,
    @Body() dto: AuthChangePasswordDto,
    @I18n() i18n,
  ) {
    await this.authService.changePassword(userId, dto);
    return successfulResult([
      i18n.t('t.The password has been successfully updated'),
    ]);
  }

  /**
   * --------------------------------------------------------
   */
  @Put('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async update(
    @User('id') userId: number,
    @Body() dto: AuthUpdateDto,
    @I18n() i18n,
  ) {
    await this.authService.update(userId, dto);
    return successfulResult([
      i18n.t('t.Your profile has been successfully updated'),
    ]);
  }

  /**
   * --------------------------------------------------------
   */
  @Post('password/forgot')
  async forgotPassword(@Body() dto: AuthForgotDto, @I18n() i18n) {
    await this.authService.forgotPassword(dto);
    return successfulResult([i18n.t('t.The verification code has been sent')]);
  }

  /**
   * --------------------------------------------------------
   */
  @Post('password/reset')
  async resetPassword(@Body() dto: AuthResetPasswordDto, @I18n() i18n) {
    const response = await this.authService.resetPasswordByToken(dto);

    return successfulResult(
      [i18n.t('Your password has been successfully changed')],
      response || {},
    );
  }
}
