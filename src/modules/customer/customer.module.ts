import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigurationModule } from '../../config/configuration.module';
import { ConfigurationService } from '../../config/configuration.service';
import { ErrorModule } from '../../error/error.module';
import { MailModule } from '../../mail/mail.module';
import { OrderModule } from '../order/order.module';
import { UserModule } from '../user/user.module';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { CustomerEntity } from './entities/customer.entity';
import { CustomerJwtStrategy } from './jwt/jwt.strategy';
import { AmootsmsModule } from '../../sms/amootsms/amootsms.module';
import { SettingModule } from '../setting/setting.module';
import { WalletHistoryEntity } from './entities/wallet-history.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerEntity, WalletHistoryEntity]),
    UserModule,
    ErrorModule,
    MailModule,
    AmootsmsModule,
    SettingModule,
    // KavenegarModule,
    PassportModule,
    forwardRef(() => OrderModule),
    JwtModule.registerAsync({
      imports: [ConfigurationModule],
      inject: [ConfigurationService],
      useFactory: (config: ConfigurationService) => ({
        secret: config.auth.customerSecret,
        signOptions: {
          expiresIn: config.auth.expires,
        },
      }),
    }),
  ],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerJwtStrategy],
  exports: [CustomerService, CustomerJwtStrategy],
})
export class CustomerModule {}
