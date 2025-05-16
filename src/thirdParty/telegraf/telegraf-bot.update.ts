import { Update, Start, Ctx } from 'nestjs-telegraf';
import { Scenes } from 'telegraf';

import { TelegrafBotService } from './telegraf-bot.service';

@Update()
export class TelegrafBotUpdate {
  constructor(private readonly telegrafBotService: TelegrafBotService) {}

  /**
   * -----------------------------------------
   */
  @Start()
  async onStart(@Ctx() ctx: Scenes.SceneContext) {
    ctx.session.__scenes.current = null;

    if (!(await this.telegrafBotService.isAccess(ctx))) {
      return false;
    }

    await ctx.reply('سلام');
  }
}
