import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class CorsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    const userAgent = request.headers['user-agent'];

    if (userAgent.toLowerCase().indexOf('postman') !== -1) {
      throw new HttpException('Access Forbidden', HttpStatus.FORBIDDEN);
    }

    // Set CORS headers on the request
    request.res.setHeader(
      'Access-Control-Allow-Origin',
      'http://your-front-end-domain.com',
    );
    request.res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE',
    );
    request.res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );

    return next.handle();
  }
}
