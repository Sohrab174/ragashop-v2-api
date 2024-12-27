import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { TelegramApiOperator, botUserIds } from './telegram-api.constants';
import { ConfigurationService } from '../../config/configuration.service';

@Injectable()
export class TelegramApiService {
  private axios;

  constructor(private config: ConfigurationService) {
    this.axios = axios.create({
      baseURL:
        this.config.app.nodeEnv === 'production'
          ? 'http://46.4.144.70:4949'
          : 'http://localhost:4949',
      timeout: 60000,
    });
  }

  // /**
  //  * -----------------------------------------
  //  */
  // async newTicket(
  //   subject: string,
  //   ticketId: number,
  //   operator = TelegramApiOperator.all,
  //   tags: string[] = [],
  // ) {
  //   await this.notification(
  //     `تیکت جدید با موضوع "${subject}" ایجاد شد.\n\nhttps://${
  //       process.env.ROOT_DOMAIN
  //     }/admin/ticket-support/${ticketId}${this.makeTags(['تیکت', ...tags])}`,
  //     operator,
  //   );
  // }

  // /**
  //  * -----------------------------------------
  //  */
  // async replyTicket(
  //   subject: string,
  //   ticketId: number,
  //   operator = TelegramApiOperator.all,
  // ) {
  //   await this.notification(
  //     `تیکت "${subject}" توسط مشتری پاسخ داده شد.\n\nhttps://${
  //       process.env.ROOT_DOMAIN
  //     }/admin/ticket-support/${ticketId}${this.makeTags(['تیکت'])}`,
  //     operator,
  //   );
  // }

  /**
   * -----------------------------------------
   */
  async sendErrorNotif(
    content: string,
    operator = TelegramApiOperator.technical,
  ) {
    await this.notification(
      `${content}${this.makeTags(['خطا'])}`,
      operator,
      true,
    );
  }

  /**
   * -----------------------------------------
   */
  async notification(
    message: string,
    operator = TelegramApiOperator.all,
    markdown = false,
  ) {
    let telegramIds = Object.values(botUserIds).flat();
    if (operator !== TelegramApiOperator.all) {
      telegramIds = botUserIds[operator];
    }

    // ignore in dev mode
    if (this.config.app.nodeEnv === 'development') return;

    try {
      await this.axios.post('/notification', {
        message,
        telegramIds,
        markdown,
      });
    } catch (e) {
      console.log(e);
    }
  }

  /**
   * -----------------------------------------
   */
  private makeTags(tags = []) {
    return `\n\n${tags.map((tag) => `#${tag.replace(/ /g, '_')}`).join(' ')}`;
  }
}
