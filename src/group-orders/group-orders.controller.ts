import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { GroupOrdersService } from './group-orders.service';

// Group ordering is anonymous. A random browser participant id is used only
// to distinguish one member's shared cart from another member's cart; it is
// not a customer account, login, session, phone number, or Customer record.
@Controller('public/restaurants/:restaurantId/group-orders')
export class GroupOrdersController {
  constructor(private readonly groupOrdersService: GroupOrdersService) {}

  @Post()
  create(
    @Param('restaurantId') restaurantId: string,
    @Body() body: { tableId: string; participantId: string; displayName?: string; phoneMasked?: string | null },
  ) {
    return this.groupOrdersService.createGroup(restaurantId, body?.tableId, body?.participantId, body?.displayName, body?.phoneMasked);
  }

  @Post('join')
  join(
    @Param('restaurantId') restaurantId: string,
    @Body() body: { groupCode: string; participantId: string; displayName?: string; phoneMasked?: string | null },
  ) {
    return this.groupOrdersService.joinGroup(restaurantId, body?.groupCode, body?.participantId, body?.displayName, body?.phoneMasked);
  }

  @Get(':groupCode')
  get(
    @Param('restaurantId') restaurantId: string,
    @Param('groupCode') groupCode: string,
    @Query('participantId') participantId?: string,
  ) {
    return this.groupOrdersService.getGroup(restaurantId, groupCode, participantId);
  }

  @Post(':groupCode/place-order')
  placeOrder(
    @Param('restaurantId') restaurantId: string,
    @Param('groupCode') groupCode: string,
    @Body() body: { participantId: string },
  ) {
    return this.groupOrdersService.placeGroupOrder(restaurantId, groupCode, body?.participantId);
  }

  @Put(':groupCode/my-items')
  syncMyItems(
    @Param('restaurantId') restaurantId: string,
    @Param('groupCode') groupCode: string,
    @Body() body: { participantId: string; items: { itemId: string; quantity: number }[] },
  ) {
    return this.groupOrdersService.syncMyItems(restaurantId, groupCode, body?.participantId, body?.items ?? []);
  }
}
