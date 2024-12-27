import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as requestIp from 'request-ip';
import * as bodyParser from 'body-parser';
// import * as bcrypt from 'bcryptjs';

import { AppModule } from './app.module';
import { ConfigurationService } from './config/configuration.service';
import { BadRequestExceptionFilter } from './utils/exceptions/bad-request.exceptions';
import { UnauthorizedExceptionFilter } from './utils/exceptions/unauthorized-request.exceptions';
import { UnprocessableEntityExceptionFilter } from './utils/exceptions/unprocessable-entity.exceptions';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  const config = app.get(ConfigurationService);

  app.use(bodyParser.json({ limit: '200mb' }));
  app.use(bodyParser.urlencoded({ limit: '200mb', extended: true }));

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

  if (config.app.nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('API')
      .setDescription('API docs')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  // const salt = await bcrypt.genSalt();
  // console.log(await bcrypt.hash('123', salt));

  await app.listen(config.app.port);
}
bootstrap();
