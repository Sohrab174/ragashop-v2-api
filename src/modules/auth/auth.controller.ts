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
import { AuthForgotDto } from './dto/auth-forgot.dto';
import { AuthResetPasswordDto } from './dto/auth-reset-password.dto';
import { AuthRateLimit } from '../../security/auth-rate-limit.decorator';
import { AuthRateLimitGuard } from '../../security/auth-rate-limit.guard';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * --------------------------------------------------------
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimit({
    kind: 'login',
    identityFields: ['emailOrMobile'],
  })
  async login(@Body() dto: AuthLoginDto) {
    const response = await this.authService.login(dto);
    return successfulResult(['با موفقیت لاگین شدید'], response);
  }

  /**
   * --------------------------------------------------------
   */
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async me(@User('id') userId: number) {
    const userInfo = await this.authService.getById(userId);
    return successfulResult(['اطلاعات کاربر'], userInfo);
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
  ) {
    await this.authService.changePassword(userId, dto);
    return successfulResult(['کلمه عبور با موفقیت آپدیت شد']);
  }

  /**
   * --------------------------------------------------------
   */
  @Put('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async update(@User('id') userId: number, @Body() dto: AuthUpdateDto) {
    await this.authService.update(userId, dto);
    return successfulResult(['پروفایل شما با موفقیت آپدیت شد']);
  }

  /**
   * --------------------------------------------------------
   */
  @Post('password/forgot')
  @AuthRateLimit({
    kind: 'otpSend',
    identityFields: ['emailOrMobile'],
  })
  async forgotPassword(@Body() dto: AuthForgotDto) {
    await this.authService.forgotPassword(dto);
    return successfulResult(['کد تایید ارسال شد']);
  }

  /**
   * --------------------------------------------------------
   */
  @Post('password/reset')
  @AuthRateLimit({
    kind: 'otpVerify',
    identityFields: ['emailOrMobile'],
  })
  async resetPassword(@Body() dto: AuthResetPasswordDto) {
    const response = await this.authService.resetPasswordByToken(dto);

    return successfulResult(['پسورد شما با موفقیت تغییر یافت'], response || {});
  }
}
