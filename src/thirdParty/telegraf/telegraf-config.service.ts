import { Injectable } from '@nestjs/common';
import { TelegrafOptionsFactory, TelegrafModuleOptions } from 'nestjs-telegraf';
import * as dotenv from 'dotenv';
import { TelegrafBotModule } from './telegraf-bot.module';
import { session } from 'telegraf';
dotenv.config();

@Injectable()
export class TelegrafConfigService implements TelegrafOptionsFactory {
  createTelegrafOptions(): TelegrafModuleOptions {
    // Local isolation: do not attach a SOCKS proxy or production Telegram agent.
    return {
      token: process.env.TELEGRAM_BOT_TOKEN || 'disabled-local-token',
      include: [TelegrafBotModule],
      middlewares: [session()],
      options: {},
    };
  }
}
