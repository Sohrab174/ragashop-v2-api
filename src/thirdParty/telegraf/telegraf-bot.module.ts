import { Module } from '@nestjs/common';
import { TelegrafBotUpdate } from './telegraf-bot.update';
import { TelegrafBotService } from './telegraf-bot.service';

@Module({
  imports: [],
  providers: [TelegrafBotUpdate, TelegrafBotService],
  exports: [TelegrafBotService],
})
export class TelegrafBotModule {}
