import { Module } from '@nestjs/common';
import { TelegrafBotService } from './telegraf-bot.service';

@Module({
  imports: [],
  providers: [TelegrafBotService],
  exports: [TelegrafBotService],
})
export class TelegrafBotModule {}
