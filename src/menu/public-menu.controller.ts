import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MenuService } from './menu.service';

// Deliberately NOT behind JwtAuthGuard — this is what a diner's browser
// calls to display a restaurant's menu, with no account of their own.
// A separate controller (not a guard exception added to MenuController)
// so there's no risk of an admin-only route accidentally losing its
// guard — same convention TableSessionsController already established
// in Day 8. Lives under /public/... so it's obvious at a glance which
// routes are intentionally open.
@Controller('public/restaurants/:restaurantId')
export class PublicMenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get('menu')
  getPublicMenu(@Param('restaurantId') restaurantId: string) {
    return this.menuService.getPublicMenu(restaurantId);
  }

  // Fixes a real 404: `GET /restaurants/:id/menu-items/:itemId/image`
  // (no /public prefix) has never had a GET handler — that path, on the
  // admin-only MenuController, is POST-to-upload / DELETE-to-remove
  // only, the same way every other resource in this API separates
  // "here's the record" (a GET, sourced from getMenu()/getPublicMenu())
  // from "mutate this record" (POST/PATCH/DELETE). This is the missing
  // read counterpart for an image specifically, deliberately public:
  // viewing an already-uploaded photo needs no admin session, and a
  // plain <img src="..."> or a pasted URL can't carry an Authorization
  // header anyway. 302s straight to the real Cloudinary URL rather than
  // proxying the bytes through this API.
  @Get('menu-items/:itemId/image')
  async getItemImage(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @Res() res: Response,
  ) {
    const imageUrl = await this.menuService.getItemImageUrl(restaurantId, itemId);
    res.redirect(imageUrl);
  }
}
