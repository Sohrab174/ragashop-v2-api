import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { Languages } from '../../global.interfaces';

import * as dotenv from 'dotenv';
dotenv.config();

export function Headers() {
  return applyDecorators(
    ApiHeader({
      name: 'x-custom-lang',
      required: true,
      schema: { default: process.env.SWAGGER_DEFAULT_LANGUAGE || Languages.fa },
    }),
    ApiHeader({
      name: 'x-token',
      required: false,
      schema: { default: process.env.SWAGGER_DEFAULT_TOKEN },
    }),
  );
}
