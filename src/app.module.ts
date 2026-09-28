import {
  Module,
  NestModule,
  MiddlewareConsumer,
  CacheModule,
} from '@nestjs/common';
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
import { CatalogModule } from './modules/catalog/catalog.module';
import { SliderModule } from './modules/slider/slider.module';
import { CustomerModule } from './modules/customer/customer.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { TransactionModule } from './modules/transaction/transaction.module';
import { AttributeModule } from './modules/attribute/attribute.module';
import { PageModule } from './modules/page/page.module';
import { TasksModule } from './tasks/tasks.module';
import { IncredibleOfferModule } from './modules/incredible-offer/Incredible-offer.module';
import { BrandModule } from './modules/brand/brand.module';
import { AddressModule } from './modules/address/address.module';
import { SettingModule } from './modules/setting/setting.module';
import { CityModule } from './modules/city/city.module';
import { NavMenuModule } from './modules/nav-menu/nav-menu.module';
import { FavoriteModule } from './modules/favorite/favorite.module';
import { CartModule } from './modules/cart/cart.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { MarketplaceImportModule } from './modules/marketplace-import/marketplace-import.module';
import { ManualPaymentModule } from './modules/manual-payment/manual-payment.module';
import { CatalogLifecycleModule } from './modules/catalog-lifecycle/catalog-lifecycle.module';
import { StorefrontHomeModule } from './modules/storefront-home/storefront-home.module';
import { SupportModule } from './modules/support/support.module';
import { TelegrafModule } from 'nestjs-telegraf';
import { TelegrafConfigService } from './thirdParty/telegraf/telegraf-config.service';
import { redisStore } from 'cache-manager-redis-yet';

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
    ...(process.env.TELEGRAM_BOT_TOKEN
      ? [
          TelegrafModule.forRootAsync({
            useClass: TelegrafConfigService,
          }),
        ]
      : []),

    // Cache Module

    // CacheModule.registerAsync({
    //   isGlobal: true,
    //   useFactory: async () => {
    //     const store = await redisStore({
    //       socket: {
    //         host: 'localhost',
    //         port: 6379,
    //       },
    //       ttl: 600,
    //       database: 0,
    //     });
    //     return { store: store as any };
    //   },
    // }),

    // Project modules
    CommonModule,
    UserModule,
    AuthModule,
    OrderModule,
    ProductModule,
    CategoryModule,
    CatalogModule,
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
    CartModule,
    CheckoutModule,
    MarketplaceImportModule,
    CatalogLifecycleModule,
    ManualPaymentModule,
    StorefrontHomeModule,
    SupportModule,
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
