import { Controller, Get, Param, Post } from '@nestjs/common';
import { TableSessionsService } from './table-sessions.service';

// Deliberately NOT behind JwtAuthGuard — this is what a diner's browser
// calls after scanning a table's QR code, with no account of their own
// (customer login/registration is explicitly out of scope for this
// task). Lives under /public/... so it's obvious at a glance — same
// convention as the (since-reverted) PublicMenuController prototype
// earlier in this project's history: public routes get their own
// controller rather than a guard exception on a shared one, so there's
// no risk of an admin-only route accidentally losing its guard.
@Controller('public/restaurants/:restaurantId/tables/:tableId/session')
export class TableSessionsController {
  constructor(private readonly tableSessionsService: TableSessionsService) {}

  @Post()
  start(@Param('restaurantId') restaurantId: string, @Param('tableId') tableId: string) {
    return this.tableSessionsService.startSession(restaurantId, tableId);
  }

  @Get()
  getActive(@Param('restaurantId') restaurantId: string, @Param('tableId') tableId: string) {
    return this.tableSessionsService.getActiveSession(restaurantId, tableId);
  }

}
