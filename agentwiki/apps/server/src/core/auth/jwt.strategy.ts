import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { fingerprintNativeJwt } from './unihub/unihub-native-session.service';

const extractBearerToken = ExtractJwt.fromAuthHeaderAsBearerToken();

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
      jwtFromRequest: extractBearerToken,
      passReqToCallback: true,
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(
    request: Pick<Request, 'headers'>,
    payload: { sub: string; email: string; type: string; authVersion?: number; unihubSid?: string },
  ) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    let fingerprint: string | undefined;
    if (payload.unihubSid === undefined && this.authService.nativeJwtRevocationEnabled) {
      const token = extractBearerToken(request);
      if (!token) throw new UnauthorizedException('Invalid token payload');
      fingerprint = fingerprintNativeJwt(token);
    }
    const principal = await this.authService.validateJwtUser(payload.sub, payload.unihubSid, fingerprint);
    if (!principal) throw new UnauthorizedException('User account is unavailable');
    if (payload.authVersion !== undefined && principal.authVersion !== undefined &&
        payload.authVersion !== principal.authVersion) {
      throw new UnauthorizedException('Token version mismatch; please log in again');
    }
    return principal;
  }
}
