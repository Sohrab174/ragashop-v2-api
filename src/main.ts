import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as requestIp from 'request-ip';
import * as bodyParser from 'body-parser';

import { AppModule } from './app.module';
import { ConfigurationService } from './config/configuration.service';
import { BadRequestExceptionFilter } from './utils/exceptions/bad-request.exceptions';
import { UnauthorizedExceptionFilter } from './utils/exceptions/unauthorized-request.exceptions';
import { UnprocessableEntityExceptionFilter } from './utils/exceptions/unprocessable-entity.exceptions';
import { validateMarketplaceImportRuntimeConfig } from './modules/marketplace-import/marketplace-config.util';
import {
  configureExpressTrustProxy,
  parseTrustProxySetting,
} from './modules/marketplace-import/trust-proxy.util';
import {
  createCorsOriginDelegate,
  isSwaggerEnabled,
  resolveCorsAllowedOrigins,
  validateLaunchSecurityRuntimeConfig,
} from './security/security-config.util';
import { createHelmetMiddleware } from './security/helmet.util';

async function bootstrap() {
  await validateMarketplaceImportRuntimeConfig();
  validateLaunchSecurityRuntimeConfig();

  const corsOrigins = resolveCorsAllowedOrigins();
  const swaggerEnabled = isSwaggerEnabled();

  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: createCorsOriginDelegate(corsOrigins),
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Accept',
        'Authorization',
        'X-Cart-Session',
        'X-RagaShop-Import-Token',
      ],
      exposedHeaders: ['X-Cart-Session'],
    },
  });
  const config = app.get(ConfigurationService);
  const expressApp = app.getHttpAdapter().getInstance();

  // Trust-proxy is ENV-driven (TRUST_PROXY_MODE=off|hops). Do NOT set true blindly.
  // Production behind one reverse proxy: TRUST_PROXY_MODE=hops TRUST_PROXY_HOPS=1
  configureExpressTrustProxy(expressApp, parseTrustProxySetting());

  expressApp.use(createHelmetMiddleware({ swaggerEnabled }));

  const globalJsonLimit = process.env.API_JSON_BODY_LIMIT || '2mb';
  const marketplaceJsonLimit =
    process.env.MARKETPLACE_IMPORT_BODY_LIMIT || '8kb';

  expressApp.use(
    '/marketplace-imports',
    bodyParser.json({ limit: marketplaceJsonLimit }),
  );
  expressApp.use(bodyParser.json({ limit: globalJsonLimit }));
  expressApp.use(
    bodyParser.urlencoded({ limit: globalJsonLimit, extended: true }),
  );

  app.useGlobalFilters(new UnprocessableEntityExceptionFilter());
  app.useGlobalFilters(new BadRequestExceptionFilter());
  app.useGlobalFilters(new UnauthorizedExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      errorHttpStatusCode: 422,
      whitelist: true,
    }),
  );

  app.use(requestIp.mw());

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('API')
      .setDescription('API docs')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.app.port);
}
bootstrap();
