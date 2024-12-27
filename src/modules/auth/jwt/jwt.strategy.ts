import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigurationService } from '../../../config/configuration.service';
import { UserEntity } from '../../user/entities/user.entity';
import { UserService } from '../../user/user.service';
import { ErrorService } from '../../../error/error.service';

type JwtPayload = Pick<UserEntity, 'id' | 'email'> & {
  iat: number;
  exp: number;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private jwtService: JwtService,
    private userService: UserService,
    private readonly config: ConfigurationService,
    private error: ErrorService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.auth.secret,
    });
  }

  public async validate(payload: JwtPayload) {
    if (!payload.id) {
      this.error.unauthorized();
    }

    const user = await this.userService.findActiveById(payload.id);
    return user;
  }
}
