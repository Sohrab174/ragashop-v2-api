import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigurationModule } from './config/configuration.module';
import { MailerModule } from '@nestjs-modules/mailer';
import './utils/typeorm.polyfill';

import { TypeOrmConfigService } from './database/typeorm-config.service';
import { AuthModule } from './modules/auth/auth.module';

import { UserModule } from './modules/user/user.module';
import { MailConfigService } from './mail/mail-config.service';
import { ErrorModule } from './error/error.module';
import { ErrorsInterceptor } from './utils/interceptors/errors.interceptor';
import { CommonModule } from './modules/common/common.module';
import { ScheduleModule } from '@nestjs/schedule';
import { OrderModule } from './modules/order/order.module';
import { ProductModule } from './modules/product/product.module';
import { CategoryModule } from './modules/category/category.module';
import { SliderModule } from './modules/slider/slider.module';
import { CustomerModule } from './modules/customer/customer.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { TransactionModule } from './modules/transaction/transaction.module';
import { AttributeModule } from './modules/attribute/attribute.module';
import { PageModule } from './modules/page/page.module';
import { TasksModule } from './tasks/tasks.module';
import { IncredibleOfferModule } from './modules/incredible-offer/Incredible-offer.module';
import { TelegramApiModule } from './thirdParty/telegram-api/telegram-api.module';
import { BrandModule } from './modules/brand/brand.module';
import { AddressModule } from './modules/address/address.module';
import { SettingModule } from './modules/setting/setting.module';
import { CityModule } from './modules/city/city.module';
import { NavMenuModule } from './modules/nav-menu/nav-menu.module';
import { FavoriteModule } from './modules/favorite/favorite.module';

@Module({
  imports: [
    // Config database for typeorm
    TypeOrmModule.forRootAsync({
      useClass: TypeOrmConfigService,
    }),
    ConfigurationModule.register(),
    MailerModule.forRootAsync({
      useClass: MailConfigService,
    }),
    ScheduleModule.forRoot(),
    ErrorModule.register(),
    TelegramApiModule,

    // Project modules
    CommonModule,
    UserModule,
    AuthModule,
    OrderModule,
    ProductModule,
    CategoryModule,
    SliderModule,
    CustomerModule,
    GatewayModule,
    TransactionModule,
    AttributeModule,
    PageModule,
    TasksModule,
    IncredibleOfferModule,
    BrandModule,
    AddressModule,
    SettingModule,
    CityModule,
    NavMenuModule,
    FavoriteModule,
    // DiscountCouponModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ErrorsInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply().forRoutes('*');
  }
}
