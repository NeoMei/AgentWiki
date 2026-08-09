import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(err: any, user: any, info: any, context: ExecutionContext, status?: any): TUser {
    const principal = super.handleRequest(err, user, info, context, status) as any;
    if (principal?.mustChangePassword) throw new UnauthorizedException('Password change required');
    return principal as TUser;
  }
}
