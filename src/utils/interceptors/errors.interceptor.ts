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

@Injectable()
export class ErrorsInterceptor implements NestInterceptor {
  constructor() {
    //
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
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
          // Avoid leaking stack / internal messages to clients in production.
          if (process.env.NODE_ENV !== 'production') {
            console.error(error);
          } else {
            console.error(
              error?.name || 'Error',
              error?.message ? String(error.message).slice(0, 200) : '',
            );
          }
          throw new InternalServerErrorException({
            success: false,
            messages: [
              process.env.NODE_ENV === 'production'
                ? 'Internal Server Error'
                : error?.message || 'Internal Server Error',
            ],
            data: {},
          });
        }
      }),
    );
  }
}
