import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { MenuService } from './menu.service';

// Generous outer cap on the multipart upload itself — deliberately
// larger than the 5MB the service actually allows (see
// MenuService.MAX_IMAGE_BYTES) so an oversized file still reaches the
// service and gets a clean `BadRequestException` with a real message,
// instead of Multer aborting the stream first with a raw, harder-to-
// read error.
const UPLOAD_SIZE_CEILING_BYTES = 8 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('restaurants/:restaurantId')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get('menu')
  getMenu(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string) {
    return this.menuService.getMenu(restaurantId, userId);
  }

  @Post('categories')
  createCategory(
    @Param('restaurantId') restaurantId: string,
    @CurrentUserId() userId: string,
    @Body() body: { name: string; sortOrder?: number },
  ) {
    return this.menuService.createCategory(restaurantId, userId, body);
  }

  @Patch('categories/:categoryId')
  updateCategory(
    @Param('restaurantId') restaurantId: string,
    @Param('categoryId') categoryId: string,
    @CurrentUserId() userId: string,
    @Body() body: { name?: string; sortOrder?: number },
  ) {
    return this.menuService.updateCategory(restaurantId, categoryId, userId, body);
  }

  @Delete('categories/:categoryId')
  deleteCategory(
    @Param('restaurantId') restaurantId: string,
    @Param('categoryId') categoryId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.menuService.deleteCategory(restaurantId, categoryId, userId);
  }

  @Post('menu-items')
  createMenuItem(
    @Param('restaurantId') restaurantId: string,
    @CurrentUserId() userId: string,
    @Body()
    body: {
      categoryId: string;
      name: string;
      description?: string;
      price: number;
      isAvailable?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.menuService.createMenuItem(restaurantId, userId, body);
  }

  @Patch('menu-items/:itemId')
  updateMenuItem(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @CurrentUserId() userId: string,
    @Body()
    body: {
      categoryId?: string;
      name?: string;
      description?: string;
      price?: number;
      isAvailable?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.menuService.updateMenuItem(restaurantId, itemId, userId, body);
  }

  @Patch('menu-items/:itemId/availability')
  setAvailability(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @CurrentUserId() userId: string,
    @Body() body: { isAvailable: boolean },
  ) {
    return this.menuService.setAvailability(restaurantId, itemId, userId, body.isAvailable);
  }

  // Day 22 — Featured toggle. Manager-only (see MenuService.setFeatured).
  @Patch('menu-items/:itemId/featured')
  setFeatured(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @CurrentUserId() userId: string,
    @Body() body: { isFeatured: boolean },
  ) {
    return this.menuService.setFeatured(restaurantId, itemId, userId, body.isFeatured);
  }

  @Delete('menu-items/:itemId')
  deleteMenuItem(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.menuService.deleteMenuItem(restaurantId, itemId, userId);
  }

  // multipart/form-data, field name "image". Kept on the existing
  // menu-items resource (not a separate "media" module/controller) —
  // an image is a property of one menu item, not an independent
  // resource today (single image per item, per this task's scope).
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit(30, 60 * 60_000)
  @Post('menu-items/:itemId/image')
  @UseInterceptors(
    FileInterceptor('image', {
      // Buffered in memory, not written to disk by Multer itself — the
      // service validates type/size against the buffer first and only
      // writes to disk once a file actually passes (see
      // MenuService.uploadItemImage). Menu photos are small; holding
      // one in memory briefly is not a concern at this scale.
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_SIZE_CEILING_BYTES },
    }),
  )
  uploadItemImage(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @CurrentUserId() userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.menuService.uploadItemImage(restaurantId, itemId, userId, file);
  }

  @Delete('menu-items/:itemId/image')
  removeItemImage(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.menuService.removeItemImage(restaurantId, itemId, userId);
  }
}
