import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { resolveClientIp } from '../modules/marketplace-import/client-ip.util';
import {
  AUTH_RATE_LIMIT_KEY,
  AuthRateLimitMeta,
} from './auth-rate-limit.decorator';
import { AuthRateLimitService } from './auth-rate-limit.service';

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: AuthRateLimitService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.getAllAndOverride<AuthRateLimitMeta>(
      AUTH_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!meta) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const ip = resolveClientIp(req);
    const { identity, fieldHint } = extractIdentity(
      req.body,
      meta.identityFields,
    );

    if (!this.rateLimitService.consume(meta.kind, ip, identity, fieldHint)) {
      throw new HttpException(
        {
          success: false,
          messages: [
            'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
          ],
          data: {},
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

function extractIdentity(
  body: Record<string, unknown> | undefined,
  fields: string[] | undefined,
): { identity: string; fieldHint?: string } {
  if (!body || !fields?.length) {
    return { identity: 'anonymous' };
  }

  for (const field of fields) {
    const value = body[field];
    if (typeof value === 'string' && value.trim()) {
      return { identity: value.trim(), fieldHint: field };
    }
  }

  return { identity: 'anonymous' };
}
