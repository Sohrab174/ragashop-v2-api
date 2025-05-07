import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class CustomerJwtAuthGuard extends AuthGuard('customer_jwt') {}

@Injectable()
export class OptionalCustomerJwtAuthGuard extends AuthGuard('customer_jwt') {
  handleRequest(err, customer, info, context: ExecutionContext) {
    return customer || null;
  }
}
