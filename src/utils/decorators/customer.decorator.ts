import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @Customer('id') customerId: number
 * @Customer() customer: CustomerEntity
 */
export const Customer = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const customer = request.user;

    return data ? customer?.[data] : customer;
  },
);
