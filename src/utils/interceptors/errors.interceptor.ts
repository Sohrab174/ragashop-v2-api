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
import {
  clientErrorMessages,
  structuredClientErrorData,
} from '../exceptions/client-error-body';
import { homeMasterMulterLimitMessage } from '../../modules/storefront-home/home-master-multer';

/** Object-form 4xx HttpException, e.g. `new BadRequestException({ message, code, details })`. */
function isObjectFormClientHttpException(
  error: unknown,
): error is HttpException {
  if (!(error instanceof HttpException)) return false;
  const status = error.getStatus();
  const response = error.getResponse();
  return (
    status >= 400 &&
    status < 500 &&
    response != null &&
    typeof response === 'object' &&
    !Array.isArray(response)
  );
}

/**
 * Nest often wraps MulterError as BadRequestException(message), dropping `code`.
 * Recover LIMIT_* from the message / nested cause for a stable 422 contract.
 */
function multerLimitCodeFromError(error: any): string | undefined {
  if (typeof error?.code === 'string' && error.code.startsWith('LIMIT_')) {
    return error.code;
  }
  if (
    typeof error?.cause?.code === 'string' &&
    error.cause.code.startsWith('LIMIT_')
  ) {
    return error.cause.code;
  }
  const responseMessage = error?.response?.message;
  const rawParts = [
    typeof error?.message === 'string' ? error.message : '',
    typeof responseMessage === 'string' ? responseMessage : '',
    Array.isArray(responseMessage) ? responseMessage.join(' ') : '',
  ];
  const msg = rawParts.join(' ').toLowerCase();
  if (msg.includes('too many fields')) return 'LIMIT_FIELD_COUNT';
  if (msg.includes('too many parts')) return 'LIMIT_PART_COUNT';
  if (msg.includes('field value too long')) return 'LIMIT_FIELD_VALUE';
  if (msg.includes('field name too long')) return 'LIMIT_FIELD_KEY';
  if (msg.includes('file too large')) return 'LIMIT_FILE_SIZE';
  if (msg.includes('too many files')) return 'LIMIT_FILE_COUNT';
  if (msg.includes('unexpected field')) return 'LIMIT_UNEXPECTED_FILE';
  return undefined;
}

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
        } else if (
          error?.name === 'MulterError' ||
          multerLimitCodeFromError(error)
        ) {
          const limitCode =
            multerLimitCodeFromError(error) || error?.code;
          throw new HttpException(
            {
              success: false,
              messages: [homeMasterMulterLimitMessage(limitCode)],
              data: {},
            },
            422,
          );
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
              data:
                error instanceof HttpException
                  ? structuredClientErrorData(error.getResponse())
                  : {},
            },
            error?.response?.statusCode,
          );
        } else if (isObjectFormClientHttpException(error)) {
          const response = error.getResponse();
          throw new HttpException(
            {
              success: false,
              messages: clientErrorMessages(response),
              data: structuredClientErrorData(response),
            },
            error.getStatus(),
          );
        } else if (
          error instanceof HttpException &&
          error.getStatus() >= 400 &&
          error.getStatus() < 500
        ) {
          // String-form 4xx (e.g. multer fileFilter HttpException) must not become 500.
          const response = error.getResponse();
          throw new HttpException(
            {
              success: false,
              messages: clientErrorMessages(response),
              data: structuredClientErrorData(response),
            },
            error.getStatus(),
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
