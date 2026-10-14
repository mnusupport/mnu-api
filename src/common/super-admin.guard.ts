import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly authorization: AuthorizationService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ userId?: string }>();
    await this.authorization.requireSuperAdmin(request.userId ?? '');
    return true;
  }
}
