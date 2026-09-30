import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MenuService } from './menu.service';

// Fix, round two. The Day 24 fix added the GET counterpart under
// `/public/restaurants/:id/menu-items/:itemId/image`, but the actual
// requests hitting this app are for the NON-public path —
// `/restaurants/:id/menu-items/:itemId/image`, no `/public` prefix,
// which is MenuController's own admin path (POST-to-upload,
// DELETE-to-remove, JwtAuthGuard-protected). Whatever in the deployed
// frontend is requesting that exact URL as an image source, it's
// happening consistently across different items — so rather than keep
// guessing at which line of frontend code does it, this makes the
// literal URL that keeps getting requested actually work.
//
// A SEPARATE, unguarded controller (not a new method added to
// MenuController) so the class-level `@UseGuards(JwtAuthGuard)` on the
// real admin controller is never touched or weakened — same reasoning
// PublicMenuController/PublicOrdersController already established for
// keeping "this route is intentionally open" impossible to miss in a
// review, just without a `/public` prefix this once, because the whole
// point is to match a URL that's already being requested without one.
// This only ever reads and 302-redirects to a value that (per
// MenuService.getItemImageUrl's own check) must already be a real,
// public `https://` Cloudinary URL — never any other field, never a
// mutation — so exposing GET here without auth adds no real exposure
// beyond what viewing the restaurant's own public menu already does.
@Controller('restaurants/:restaurantId/menu-items')
export class MenuImageRedirectController {
  constructor(private readonly menuService: MenuService) {}

  @Get(':itemId/image')
  async getItemImage(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @Res() res: Response,
  ) {
    const imageUrl = await this.menuService.getItemImageUrl(restaurantId, itemId);
    res.redirect(imageUrl);
  }
}
