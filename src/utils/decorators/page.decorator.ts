import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const Page = createParamDecorator((data, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.query?.page ? +request.query?.page : data;
});
