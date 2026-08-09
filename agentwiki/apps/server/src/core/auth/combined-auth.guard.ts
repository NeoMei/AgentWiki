import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuditService } from '../security/audit.service';

@Injectable()
export class CombinedAuthGuard {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const apiKey = request.headers['x-api-key'];

    let jwtError: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const payload = this.jwtService.verify(token);
        const principal = await this.authService.validateJwtUser(payload.sub);
        if (!principal) {
          jwtError = 'Token payload is no longer valid';
        } else if (payload.authVersion !== undefined && principal.authVersion !== undefined && payload.authVersion !== principal.authVersion) {
          jwtError = 'Token version mismatch; please log in again';
        } else {
          this.assertPasswordChanged(request, principal);
          request.user = principal;
          return true;
        }
      } catch (err: any) {
        if (err instanceof UnauthorizedException) {
          throw err;
        }
        if (token.startsWith('awk_') || token.startsWith('agk_')) {
          const result = await this.authService.validateApiKey(token);
          if (result) {
            this.assertPasswordChanged(request, result);
            request.user = result;
            await this.audit.record({
              action: 'api_key.authenticate', outcome: 'success', actorUserId: result.userId,
              actorAgentId: result.agentId, ipAddress: request.ip, userAgent: request.headers['user-agent'],
              metadata: { credentialId: result.credentialId, transport: 'bearer' },
            });
            return true;
          }
          await this.audit.record({
            action: 'api_key.authenticate', outcome: 'failure', ipAddress: request.ip,
            userAgent: request.headers['user-agent'], metadata: { transport: 'bearer' },
          });
        } else {
          jwtError = err?.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token';
        }
      }
    }

    if (apiKey) {
      const result = await this.authService.validateApiKey(apiKey);
      if (result) {
        this.assertPasswordChanged(request, result);
        request.user = result;
        await this.audit.record({
          action: 'api_key.authenticate',
          outcome: 'success',
          actorUserId: result.userId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          metadata: { credentialId: result.credentialId },
          actorAgentId: result.agentId,
        });
        return true;
      }
      await this.audit.record({
        action: 'api_key.authenticate',
        outcome: 'failure',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
    }

    throw new UnauthorizedException(jwtError || 'Valid JWT token or API key required');
  }

  private assertPasswordChanged(request: any, principal: unknown) {
    if (!(principal as { mustChangePassword?: boolean })?.mustChangePassword) return;
    const path = String(request.originalUrl || request.url || '').split(/[?#]/, 1)[0];
    if (path !== '/api/auth/change-required-password') {
      throw new UnauthorizedException('Password change required');
    }
  }
}
