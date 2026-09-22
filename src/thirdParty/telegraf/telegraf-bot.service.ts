import { Injectable, Optional } from '@nestjs/common';
import { Context, Scenes, Telegraf } from 'telegraf';
import { BOT_ADMIN_IDS } from './telegraf-bot.constants';
import { InjectBot } from 'nestjs-telegraf';

@Injectable()
export class TelegrafBotService {
  constructor(@Optional() @InjectBot() private bot?: Telegraf<Context>) {}

  async isAccess(ctx: Scenes.SceneContext) {
    if (!this.bot) return false;
    const isAdmin = BOT_ADMIN_IDS.includes(ctx.from.id);
    if (!isAdmin) {
      await ctx.reply('You are not admin 😡');
      return false;
    }
    return true;
  }

  async sendNotification(
    message: string,
    telegramIds: number[] = null,
    markdown = false,
  ) {
    if (!this.bot) {
      return;
    }
    telegramIds = telegramIds || BOT_ADMIN_IDS;
    for (let i = 0; i < telegramIds.length; i++) {
      await this.bot.telegram.sendMessage(telegramIds[i], message, {
        ...(markdown && { parse_mode: 'Markdown' }),
      });
    }
  }
}
