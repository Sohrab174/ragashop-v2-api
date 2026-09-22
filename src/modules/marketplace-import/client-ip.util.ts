import { Request } from 'express';

export function normalizeClientIp(ip: string | undefined): string {
  if (!ip || !ip.trim()) {
    return 'unknown';
  }

  const trimmed = ip.trim();
  const mappedPrefix = '::ffff:';
  if (trimmed.toLowerCase().startsWith(mappedPrefix)) {
    return trimmed.slice(mappedPrefix.length);
  }

  return trimmed;
}

/**
 * Returns the client IP resolved by Express after trust-proxy configuration.
 * Does not manually parse X-Forwarded-For or other forwarding headers.
 */
export function resolveClientIp(req: Request): string {
  if (req.ip) {
    return normalizeClientIp(req.ip);
  }

  return normalizeClientIp(
    req.socket?.remoteAddress ||
      (req as { connection?: { remoteAddress?: string } }).connection
        ?.remoteAddress,
  );
}
