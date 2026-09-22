import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

@Injectable()
export class ErrorService {
  private httpError(messages: string[], data = {}, type: HttpStatus): never {
    throw new HttpException(
      {
        success: false,
        messages: messages.map((message) =>
          typeof message === 'string' ? message : message,
        ),
        data,
      },
      type,
    );
  }

  unprocessableEntity(messages: string[], data = {}): never {
    this.httpError(messages, data, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  unauthorized(messages = ['Unauthorized Error'], data = {}): never {
    this.httpError(messages, data, HttpStatus.UNAUTHORIZED);
  }

  forbidden(messages = ['Forbidden Error'], data = {}): never {
    this.httpError(messages, data, HttpStatus.FORBIDDEN);
  }

  internalServerError(messages = ['Internal Server Error'], data = {}): never {
    this.httpError(messages, data, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  methodNotAllowed(messages = ['Method Not Allowed Error'], data = {}): never {
    this.httpError(messages, data, HttpStatus.METHOD_NOT_ALLOWED);
  }

  conflict(messages: string[], data = {}): never {
    this.httpError(messages, data, HttpStatus.CONFLICT);
  }

  notFound(messages: string[], data = {}): never {
    this.httpError(messages, data, HttpStatus.NOT_FOUND);
  }
}
