import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { MailerOptions, MailerOptionsFactory } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { ConfigurationService } from '../config/configuration.service';

@Injectable()
export class MailConfigService implements MailerOptionsFactory {
  constructor(private config: ConfigurationService) {}

  createMailerOptions(): MailerOptions {
    return {
      transport: {
        host: this.config.mail.host,
        port: this.config.mail.port,
        ignoreTLS: this.config.mail.ignoreTLS,
        secure: this.config.mail.secure,
        requireTLS: this.config.mail.requireTLS,
        auth: {
          user: this.config.mail.user,
          pass: this.config.mail.password,
        },
      },
      defaults: {
        from: `"${this.config.mail.defaultName}" <${this.config.mail.defaultEmail}>`,
      },
      template: {
        dir: join(__dirname, 'templates'),
        adapter: new HandlebarsAdapter(undefined, {
          inlineCssEnabled: true,
          /** See https://www.npmjs.com/package/inline-css#api */
          inlineCssOptions: {},
        }),
        options: {
          strict: true,
        },
      },
      options: {
        partials: {
          dir: join(__dirname, 'templates', 'partials'),
          options: {
            strict: true,
          },
        },
      },
    } as MailerOptions;
  }
}
