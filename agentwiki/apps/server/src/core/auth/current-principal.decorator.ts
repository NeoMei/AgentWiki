import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Principal } from '../authorization/authorization.service';

export const CurrentPrincipal = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): Principal => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as Principal;
  },
);
