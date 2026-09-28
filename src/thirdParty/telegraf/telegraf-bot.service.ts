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

  /** Best-effort: never rejects; one failed recipient does not stop the rest. */
  async sendNotification(
    message: string,
    telegramIds: number[] = null,
    markdown = false,
  ): Promise<void> {
    if (!this.bot) {
      return;
    }
    telegramIds = telegramIds || BOT_ADMIN_IDS;
    for (let i = 0; i < telegramIds.length; i++) {
      try {
        await this.bot.telegram.sendMessage(telegramIds[i], message, {
          ...(markdown && { parse_mode: 'Markdown' }),
        });
      } catch (e) {
        // Do not log the message body, recipient, or token-bearing request data.
        console.error('Telegram notification failed', {
          errorCode: e?.response?.error_code ?? e?.code ?? null,
        });
      }
    }
  }
}
