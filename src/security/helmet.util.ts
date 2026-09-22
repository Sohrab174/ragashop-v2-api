import * as helmetImport from 'helmet';
import { isProductionEnv } from './security-config.util';

const helmet: typeof helmetImport =
  (helmetImport as unknown as { default: typeof helmetImport }).default ||
  helmetImport;

/**
 * API-oriented Helmet defaults.
 * CSP is relaxed only when Swagger UI is enabled (dev/docs surface).
 */
export function createHelmetMiddleware(options: {
  swaggerEnabled: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const production = isProductionEnv(options.env);

  return helmet({
    contentSecurityPolicy: options.swaggerEnabled
      ? {
          useDefaults: true,
          directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'", "'unsafe-inline'"],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:'],
            'connect-src': ["'self'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    hsts: production
      ? {
          maxAge: 15_552_000,
          includeSubDomains: true,
          preload: false,
        }
      : false,
  });
}
