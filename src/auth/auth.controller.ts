import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUserId } from './current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit(5, 60_000)
  @Post('register')
  register(
    @Body()
    body: {
      restaurant_name: string;
      name: string;
      email: string;
      password: string;
      password_confirmation: string;
    },
  ) {
    return this.authService.register(body);
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

  // JWTs are stateless and short-lived (7d) — there's no server-side
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
