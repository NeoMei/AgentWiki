import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class HumanOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const principal = context.switchToHttp().getRequest().user;
    if (!principal || principal.agentId || principal.type !== 'human') {
      throw new ForbiddenException('This operation requires a human account');
    }
    return true;
  }
}
