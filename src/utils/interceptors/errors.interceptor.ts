import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  InternalServerErrorException,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { sliceText } from '..';
import { TelegramApiService } from '../../thirdParty/telegram-api/telegram-api.service';

@Injectable()
export class ErrorsInterceptor implements NestInterceptor {
  constructor(private readonly telegramApiService: TelegramApiService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        const { method, url, user, body, headers } = context
          .switchToHttp()
          .getRequest();

        const errorMessage =
          error?.response?.message?.[0] ||
          error?.response?.messages?.[0] ||
          error?.message ||
          '';

        // if (
        //   process.env.NODE_ENV === 'production' &&
        //   !['companies/domain', 'companies/code', 'blogs/wp-includes'].some(
        //     (m) => url.indexOf(m) !== -1,
        //   ) &&
        //   errorMessage !== 'محصول مورد نظر یافت نشد!'
        // ) {
        //   try {
        //     if (body) {
        //       for (const key in body) {
        //         if (key.toLowerCase().includes('password')) {
        //           body[key] = '***';
        //         }
        //       }
        //     }

        //     let urlText = `${method || ''} ${url || ''}`.trim();
        //     urlText = urlText ? `\`\`\`${urlText}\`\`\`\n` : '';
        //     const userText = user
        //       ? `کاربر: #${user.id} ${user?.firstName || ''} ${
        //           user?.lastName || ''
        //         }\n`
        //       : '';
        //     let bodyText = body ? JSON.stringify(body) : '';
        //     bodyText =
        //       bodyText !== '{}'
        //         ? `\`\`\`${sliceText(bodyText, 500)}\`\`\`\n`
        //         : '';
        //     const browser = headers?.['user-agent']
        //       ? `\n\`${headers['user-agent']}\`\n`
        //       : '';
        //     const origin = headers?.origin ? `\`${headers.origin}\`\n` : '';
        //     const sqlText = error?.sql ? `\n\`\`\`${error.sql}\`\`\`` : '';

        //     this.telegramApiService.sendErrorNotif(
        //       `${errorMessage}\n\n${urlText}${bodyText}${userText}${browser}${origin}${sqlText}`,
        //     );
        //   } catch (e) {
        //     console.error(e);
        //     console.log('SEND NOTIF ERROR', e);
        //   }
        // }

        if (error?.response?.success === false) {
          throw error;
        } else if (error?.response?.statusCode) {
          throw new HttpException(
            {
              success: false,
              messages:
                error instanceof PayloadTooLargeException
                  ? 'حجم فایل زیاد است'
                  : typeof error?.response?.message === 'object'
                  ? error?.response?.message || 'Error'
                  : [error?.response?.error || 'Error'],
              data: {},
            },
            error?.response?.statusCode,
          );
        } else {
          console.error(error);
          throw new InternalServerErrorException({
            success: false,
            messages: [error?.message || 'Internal Server Error'],
            data: {},
          });
        }
      }),
    );
  }
}
