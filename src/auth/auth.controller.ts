import { Body, Controller, Get, Post, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUserId } from './current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register() {
    // Restaurant registration is intentionally not a public/self-service
    // capability. Restaurant creation is controlled by Super Admin.
    throw new ForbiddenException('Restaurant registration is available only to Super Admin.');
  }

  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60_000)
  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUserId() userId: string) {
    return this.authService.me(userId);
  }

  // JWTs are stateless and expire after 30d — there's no server-side
  // session to destroy. This endpoint exists so the client has a single,
  // consistent "log out" call (and a hook point for a token-blocklist
  // later, if that's ever needed); the guard also confirms the token was
  // actually valid before agreeing to "log out". Real invalidation is the
  // client discarding the token, which the frontend does regardless.
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout() {
    return { message: 'Logged out.' };
  }
}
