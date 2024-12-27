import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { ConfigurationModule } from '../../config/configuration.module';
import { ConfigurationService } from '../../config/configuration.service';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt/jwt.strategy';
import { MailModule } from '../../mail/mail.module';
import { KavenegarModule } from '../../sms/kavenegar/kavenegar.module';
// import { AmootsmsModule } from '../../sms/amootsms/amootsms.module';

@Module({
  imports: [
    UserModule,
    PassportModule,
    MailModule,
    // AmootsmsModule,
    KavenegarModule,
    JwtModule.registerAsync({
      imports: [ConfigurationModule],
      inject: [ConfigurationService],
      useFactory: (config: ConfigurationService) => ({
        secret: config.auth.secret,
        signOptions: {
          expiresIn: config.auth.expires,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
