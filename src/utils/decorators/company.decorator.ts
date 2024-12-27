import {
  createParamDecorator,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

export const Company = createParamDecorator((select, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const company = request.company;

  if (!company) {
    console.log('company decorator');

    throw new HttpException(
      {
        success: false,
        messages: ['The request is not valid!'],
        data: null,
      },
      HttpStatus.METHOD_NOT_ALLOWED,
    );
  }

  if (select) {
    return company?.[select] || null;
  }

  return company;
});
