import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { CustomerAuthGuard } from '../customers/customer-auth.guard';
import { CurrentCustomerId } from '../customers/current-customer.decorator';
import { GroupOrdersService } from './group-orders.service';

// Every route here is behind CustomerAuthGuard — same *customer* session
// (not staff) that placing an order already requires (Day 17). Browsing
// the menu stays anonymous; joining or creating a group is the point at
// which "who are you" has to be answerable, because a group lobby lists
// its members by name.
//
// restaurantId comes from the URL and is re-validated against the group
// on every single lookup inside the service — it is never taken on trust
// (Part 10). customerId comes from the verified token, never the body.
@UseGuards(CustomerAuthGuard)
@Controller('public/restaurants/:restaurantId/group-orders')
export class GroupOrdersController {
  constructor(private readonly groupOrdersService: GroupOrdersService) {}

  @Post()
  create(
    @Param('restaurantId') restaurantId: string,
    @Body() body: { tableId: string },
    @CurrentCustomerId() customerId: string,
  ) {
    return this.groupOrdersService.createGroup(restaurantId, body?.tableId, customerId);
  }

  @Post('join')
  join(
    @Param('restaurantId') restaurantId: string,
    @Body() body: { groupCode: string },
    @CurrentCustomerId() customerId: string,
  ) {
    return this.groupOrdersService.joinGroup(restaurantId, body?.groupCode, customerId);
  }

  @Get(':groupCode')
  get(
    @Param('restaurantId') restaurantId: string,
    @Param('groupCode') groupCode: string,
    @CurrentCustomerId() customerId: string,
  ) {
    return this.groupOrdersService.getGroup(restaurantId, groupCode, customerId);
  }

  // Places the group's ONE combined order. Any member can submit;
  // repeated calls return the same order rather than creating another
  // (see GroupOrdersService.placeGroupOrder).
  @Post(':groupCode/place-order')
  placeOrder(
    @Param('restaurantId') restaurantId: string,
    @Param('groupCode') groupCode: string,
    @CurrentCustomerId() customerId: string,
  ) {
    return this.groupOrdersService.placeGroupOrder(restaurantId, groupCode, customerId);
  }

  // Syncs the caller's personal cart into their own slot in the group.
  // PUT (not PATCH) because it's a wholesale replace of that member's
  // contribution — see GroupOrdersService.syncMyItems.
  @Put(':groupCode/my-items')
  syncMyItems(
    @Param('restaurantId') restaurantId: string,
    @Param('groupCode') groupCode: string,
    @Body() body: { items: { itemId: string; quantity: number }[] },
    @CurrentCustomerId() customerId: string,
  ) {
    return this.groupOrdersService.syncMyItems(restaurantId, groupCode, customerId, body?.items ?? []);
  }
}
