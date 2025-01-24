import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';
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
    const i18n = I18nContext.current();

    const title = `${i18n.t('t.Forgot password').replace(/^t\./i, '')} ${
      this.config.app.name
    }`;
    const url = `${this.config.app.siteBaseUrl}/auth/reset-password?token=${mailData.data.hash}`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: `${url} ${i18n.t('t.Forgot password').replace(/^t\./i, '')}`,
      template: `reset-password-${i18n.lang}`,
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
    const i18n = I18nContext.current();

    const title = `${i18n.t('t.Forgot password').replace(/^t\./i, '')} - ${
      this.config.app.name
    }`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: `${i18n.t('t.Forgot password').replace(/^t\./i, '')}`,
      template: `reset-customer-password-${i18n.lang}`,
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
    const i18n = I18nContext.current();

    const title = `${i18n.t('t.Welcome to').replace(/^t\./i, '')} ${
      this.config.app.name
    }
    - ${i18n.t('t.Confirm Email')}`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: `${i18n.t('t.Confirm Email').replace(/^t\./i, '')}`,
      template: `confirmation-${i18n.lang}`,
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
    const i18n = I18nContext.current();

    const title = `${i18n.t('t.New order').replace(/^t\./i, '')} ${
      this.config.app.name
    }`;

    return await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: `${i18n.t('t.New order').replace(/^t\./i, '')}`,
      template: `notif-new-order-admin-${i18n.lang}`,
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
    const i18n = I18nContext.current();

    const title = `${i18n.t('t.Reply to your ticket').replace(/^t\./i, '')} ${
      this.config.app.name
    }`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: `${i18n.t('t.Reply to your ticket').replace(/^t\./i, '')}`,
      template: `notif-ticket-admin-${i18n.lang}`,
      context: {
        ticket_subject: mailData.data.subject,
        app_name: this.config.app.name,
        title,
      },
    });
  }
}
