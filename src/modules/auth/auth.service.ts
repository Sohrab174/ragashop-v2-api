import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { I18nContext } from 'nestjs-i18n';
import * as moment from 'jalali-moment';

import { ConfigurationService } from '../../config/configuration.service';
import { ErrorService } from '../../error/error.service';
import { UserEntity, UserStatus } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { AuthChangePasswordDto } from './dto/auth-change-password.dto';
import { AuthLoginDto } from './dto/auth-login.dto';
import { AuthUpdateDto } from './dto/auth-update.dto';
import { AuthForgotDto } from './dto/auth-forgot.dto';
import { MailService } from '../../mail/mail.service';
// import { AmootsmsService } from '../../sms/amootsms/amootsms.service';
import { AuthResetPasswordDto } from './dto/auth-reset-password.dto';
import { KavenegarService } from '../../sms/kavenegar/kavenegar.service';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private error: ErrorService,
    private mail: MailService,
    // private amootsmsService: AmootsmsService,
    private kavenegarService: KavenegarService,
    private config: ConfigurationService,
    private jwtService: JwtService,
  ) {}

  /**
   * --------------------------------------------------------
   */
  async login(dto: AuthLoginDto) {
    const user = await this.userService.getActiveByEmailOrMobile(
      dto.emailOrMobile,
    );

    if (!user) {
      this.error.unprocessableEntity([
        't.The username or password is incorrect',
      ]);
    }

    if (!(await user.isCorrectSaltPassword(dto.password))) {
      this.error.unprocessableEntity([
        't.The username or password is incorrect',
      ]);
    }

    if (user.status === UserStatus.inactive) {
      this.error.unprocessableEntity(['t.Your account is inactive']);
    }

    return await this.prepareUserResponse(user, dto.rememberMe);
  }

  /**
   * --------------------------------------------------------
   * Preparing the user info and an access token for responding to signup and login requests
   * Generating the JWT access token, if the user is verified
   */
  async prepareUserResponse(user: UserEntity, rememberMe = false) {
    const accessToken = await this._generateAccessToken(user, rememberMe);

    return {
      user: {
        id: user.id,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        fullName: `${user.firstName} ${user.lastName}`.trim(),
        firstName: user.firstName,
        lastName: user.lastName,
      },
      accessToken,
    };
  }

  /**
   * --------------------------------------------------------
   * Generating the JWT access token based on the user's ID and email
   */
  private async _generateAccessToken(user: UserEntity, rememberMe = false) {
    return await this.jwtService.sign(
      {
        id: user.id,
        email: user.email,
        mobile: user.mobile,
      },
      {
        expiresIn: rememberMe
          ? this.config.auth.expiresLifetime
          : this.config.auth.expires,
      },
    );
  }

  /**
   * --------------------------------------------------------
   */
  async getById(userId: number) {
    return await this.userService.getById(userId);
  }

  /**
   * --------------------------------------------------------
   */
  async update(userId: number, dto: AuthUpdateDto) {
    delete dto.id;
    await this.userService.updateUser(userId, dto);
  }

  /**
   * --------------------------------------------------------
   */
  async changePassword(userId: number, dto: AuthChangePasswordDto) {
    await this.userService.changePassword(
      userId,
      dto.oldPassword,
      dto.newPassword,
    );
  }

  /**
   * --------------------------------------------------------
   */
  async forgotPassword(dto: AuthForgotDto) {
    const i18n = I18nContext.current();

    const user = await this.userService.findActiveUserByMobileOrEmail(
      dto.emailOrMobile,
    );

    if (moment(user.expireRandomHash).isAfter(moment())) {
      this.error.unprocessableEntity([
        i18n.t(
          't.The verification code has already been sent, please try again in a few minutes!',
        ),
      ]);
    }

    user.randomHash = await this._generateVerifyCode();
    user.expireRandomHash = moment().add(5, 'minutes').toDate();
    await user.save();

    // Sending SMS
    await this.kavenegarService.sendOTP(user.mobile, user.randomHash);

    return user;
  }

  /**
   * --------------------------------------------------------
   */
  async resetPasswordByToken(dto: AuthResetPasswordDto) {
    const i18n = I18nContext.current();

    const user = await this.userService.findActiveUserByMobileOrEmail(
      dto.emailOrMobile,
    );

    if (
      user.randomHash !== dto.code ||
      !moment(user.expireRandomHash).isAfter(moment())
    ) {
      return this.error.unprocessableEntity([
        i18n.t('t.The verification code is invalid or expired'),
      ]);
    }

    user.randomHash = null;
    user.expireRandomHash = null;
    user.password = dto.newPassword;
    await user.save();

    return await this.prepareUserResponse(user, false);
  }

  /**
   * --------------------------------------------------------
   */
  private async _generateVerifyCode() {
    while (true) {
      const randomNumber = String(Math.floor(10000 + Math.random() * 90000));

      const user = await this.userService.findByValidHashCode(randomNumber);
      if (!user) {
        return randomNumber;
      }
    }
  }
}
