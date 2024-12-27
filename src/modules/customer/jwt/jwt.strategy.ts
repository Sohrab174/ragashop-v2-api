import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigurationService } from '../../../config/configuration.service';
import { ErrorService } from '../../../error/error.service';
import { CustomerService } from '../customer.service';
import { CustomerEntity } from '../entities/customer.entity';

type JwtPayload = Pick<CustomerEntity, 'id' | 'email'> & {
  iat: number;
  exp: number;
};

@Injectable()
export class CustomerJwtStrategy extends PassportStrategy(
  Strategy,
  'customer_jwt',
) {
  constructor(
    private jwtService: JwtService,
    private customerService: CustomerService,
    private readonly config: ConfigurationService,
    private error: ErrorService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.auth.customerSecret,
    });
  }

  public async validate(payload: JwtPayload) {
    if (!payload.id) {
      this.error.unauthorized();
    }

    // TODO: check company
    const customer = await this.customerService.getActiveById(payload.id);
    return customer;
  }
}
