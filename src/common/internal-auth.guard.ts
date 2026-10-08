/**
 * Shared-secret guard for internal service calls (crawler → API).
 * Mirrors ragashop-crawler InternalAuthGuard: header `x-crawler-secret`
 * must match CRAWLER_INTERNAL_SECRET (timing-safe).
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

function requireInternalSecret(): string {
  const raw = (process.env.CRAWLER_INTERNAL_SECRET || '').trim();
  if (!raw) {
    throw new UnauthorizedException({
      success: false,
      messages: ['Unauthorized'],
      data: {},
    });
  }
  return raw;
}

@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    let expected: string;
    try {
      expected = requireInternalSecret();
    } catch {
      throw new UnauthorizedException({
        success: false,
        messages: ['Unauthorized'],
        data: {},
      });
    }

    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-crawler-secret'];

    if (!provided || typeof provided !== 'string') {
      throw new UnauthorizedException({
        success: false,
        messages: ['Unauthorized'],
        data: {},
      });
    }

    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new UnauthorizedException({
        success: false,
        messages: ['Unauthorized'],
        data: {},
      });
    }

    return true;
  }
}
