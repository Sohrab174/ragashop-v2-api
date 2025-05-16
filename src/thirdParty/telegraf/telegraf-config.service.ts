import { Injectable } from '@nestjs/common';
import { TelegrafOptionsFactory, TelegrafModuleOptions } from 'nestjs-telegraf';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as dotenv from 'dotenv';
import { TelegrafBotModule } from './telegraf-bot.module';
import { session } from 'telegraf';
dotenv.config();

@Injectable()
export class TelegrafConfigService implements TelegrafOptionsFactory {
  createTelegrafOptions(): TelegrafModuleOptions {
    const options: any = {};

    if (process.env.NODE_ENV === 'development') {
      options.telegram = {
        agent: new SocksProxyAgent({
          hostname: '127.0.0.1',
          port: '10808',
          // port: '10808',
        }),
      };
    }

    return {
      token: process.env.TELEGRAM_BOT_TOKEN,
      include: [TelegrafBotModule],
      middlewares: [session()],
      options,
    };
  }
}
