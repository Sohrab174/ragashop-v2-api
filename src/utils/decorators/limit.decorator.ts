import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const Limit = createParamDecorator(
  (maxLimitPerPage: number, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    if (request.query?.limit) {
      if (maxLimitPerPage) {
        return request.query.limit <= maxLimitPerPage
          ? request.query.limit
          : maxLimitPerPage;
      }
      return request.query.limit;
    }
    return undefined;
  },
);
