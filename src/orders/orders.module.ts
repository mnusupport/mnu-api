import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from './schemas/order.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { Table, TableSchema } from '../tables/schemas/table.schema';
import { TableSession, TableSessionSchema } from '../table-sessions/schemas/table-session.schema';
import { MenuItem, MenuItemSchema } from '../menu/schemas/menu-item.schema';
import { RestaurantMember, RestaurantMemberSchema } from '../restaurant-members/schemas/restaurant-member.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { CustomersModule } from '../customers/customers.module';
import { OrdersController, AnalyticsController, CustomersController } from './orders.controller';
import { PublicOrdersController } from './public-orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    // DatabaseModule already registers these globally; re-listing them
    // here keeps this module's model dependencies explicit — same
    // convention TableSessionsModule/TablesModule already use.
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: Table.name, schema: TableSchema },
      { name: TableSession.name, schema: TableSessionSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: RestaurantMember.name, schema: RestaurantMemberSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
    CustomersModule,
  ],
  controllers: [OrdersController, AnalyticsController, CustomersController, PublicOrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
