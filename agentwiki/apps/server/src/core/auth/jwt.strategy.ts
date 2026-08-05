import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const secret = configService.get<string>('JWT_SECRET') || process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: { sub: string; email: string; type: string; authVersion?: number }) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    const principal = await this.authService.validateJwtUser(payload.sub);
    if (!principal) throw new UnauthorizedException('User account is unavailable');
    if (payload.authVersion !== undefined && principal.authVersion !== undefined &&
        payload.authVersion !== principal.authVersion) {
      throw new UnauthorizedException('Token version mismatch; please log in again');
    }
    return principal;
  }
}
