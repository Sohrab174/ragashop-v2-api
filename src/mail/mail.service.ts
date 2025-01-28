import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../config/configuration.service';
import { MailData } from './interfaces/mail-data.interface';

@Injectable()
export class MailService {
  constructor(
    private mailerService: MailerService,
    private config: ConfigurationService,
  ) {}

  /**
   * ************************************
   */
  async sendForgotPassword(
    mailData: MailData<{
      hash: string;
      firstName: string;
      lastName: string;
    }>,
  ) {
    const title = `${'فراموشی کلمه عبور'} ${this.config.app.name}`;
    const url = `${this.config.app.siteBaseUrl}/auth/reset-password?token=${mailData.data.hash}`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: `${url} ${'فراموشی کلمه عبور'}`,
      template: `reset-password`,
      context: {
        full_name:
          `${mailData.data.firstName} ${mailData.data.lastName}`.trim(),
        url,
        app_name: this.config.app.name,
        title,
      },
    });
  }

  /**
   * ************************************
   */
  async sendCustomerForgotPassword(
    mailData: MailData<{
      code: string;
      firstName: string;
      lastName: string;
    }>,
  ) {
    const title = `${'فراموشی کلمه عبور'} - ${this.config.app.name}`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: `${'فراموشی کلمه عبور'}`,
      template: `reset-customer-password`,
      context: {
        full_name:
          `${mailData.data.firstName} ${mailData.data.lastName}`.trim(),
        code: mailData.data.code,
        app_name: this.config.app.name,
        title,
      },
    });
  }

  /**
   * ************************************
   */
  async sendCustomerConfirmation(mailData: MailData<{ code: string }>) {
    const title = `${'خوش آمدید به'} ${this.config.app.name}
    - ${'تایید ایمیل'}`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: `${'تایید ایمیل'}`,
      template: `confirmation`,
      context: {
        email: mailData.to,
        code: mailData.data.code,
        app_name: this.config.app.name,
        title,
      },
    });
  }

  /**
   * ************************************
   */
  async sendAlertCountSms(
    mailData: MailData<{
      smsUsedCount: number;
    }>,
  ) {
    const title = `Alert SMS count - ${this.config.app.name}`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: title,
      template: `alert-sms-count`,
      context: {
        smsUsedCount: mailData.data.smsUsedCount,
        app_name: this.config.app.name,
        title,
      },
    });
  }

  /**
   * ************************************
   */
  async sendNewOrderToAdmin(
    mailData: MailData<{
      amount: number;
      number: string;
      currency: string;
    }>,
  ) {
    const title = `${'سفارش جدید'} ${this.config.app.name}`;

    return await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: `${'سفارش جدید'}`,
      template: `notif-new-order-admin`,
      context: {
        amount: mailData.data.amount,
        number: mailData.data.number,
        currency: mailData.data.currency,
        app_name: this.config.app.name,
        title,
      },
    });
  }

  /**
   * ************************************
   */
  async sendNotifTicketToAdmin(
    mailData: MailData<{
      subject: string;
    }>,
  ) {
    const title = `${'پاسخ به تیکت شما'} ${this.config.app.name}`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: `${'پاسخ به تیکت شما'}`,
      template: `notif-ticket-admin`,
      context: {
        ticket_subject: mailData.data.subject,
        app_name: this.config.app.name,
        title,
      },
    });
  }
}
