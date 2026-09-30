import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GroupOrder, GroupOrderSchema } from './schemas/group-order.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { Table, TableSchema } from '../tables/schemas/table.schema';
import { TableSession, TableSessionSchema } from '../table-sessions/schemas/table-session.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { MenuItem, MenuItemSchema } from '../menu/schemas/menu-item.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { CustomersModule } from '../customers/customers.module';
import { GroupOrdersController } from './group-orders.controller';
import { GroupOrdersService } from './group-orders.service';

@Module({
  imports: [
    // Re-listed explicitly even though DatabaseModule registers them
    // globally — same convention OrdersModule/TablesModule already use.
    MongooseModule.forFeature([
      { name: GroupOrder.name, schema: GroupOrderSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: Table.name, schema: TableSchema },
      { name: TableSession.name, schema: TableSessionSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    // For CustomerAuthGuard.
    CustomersModule,
  ],
  controllers: [GroupOrdersController],
  providers: [GroupOrdersService],
})
export class GroupOrdersModule {}
