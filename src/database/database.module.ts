import { Global, Logger, Module } from '@nestjs/common';
import { Connection } from 'mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { RestaurantMember, RestaurantMemberSchema } from '../restaurant-members/schemas/restaurant-member.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Category, CategorySchema } from '../menu/schemas/category.schema';
import { MenuItem, MenuItemSchema } from '../menu/schemas/menu-item.schema';
import { Table, TableSchema } from '../tables/schemas/table.schema';
import { TableSession, TableSessionSchema } from '../table-sessions/schemas/table-session.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { GroupOrder, GroupOrderSchema } from '../group-orders/schemas/group-order.schema';

// Global so any future feature module can inject the User/Restaurant/
// RestaurantMember/Category/MenuItem/Table/TableSession/Order/Customer/
// models without re-importing this module everywhere — the
// same role PrismaModule played, just for Mongoose instead of Prisma.
@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('MongoDB');
        return {
          uri: config.get<string>('DATABASE_URL'),
          // Fail fast (and visibly) instead of hanging for the 30s driver
          // default when Atlas is unreachable or the IP allow-list blocks us.
          // Bounded startup retries (3 x ~10s + 2s) so a bad URI / blocked IP
          // fails in well under a minute with a clear log line and exit code 1.
          retryAttempts: 3,
          retryDelay: 2_000,
          serverSelectionTimeoutMS: 10_000,
          connectTimeoutMS: 10_000,
          socketTimeoutMS: 45_000,
          // Small pilot on a single API instance; Atlas M0/M10 connection
          // limits are the real ceiling, so keep the pool modest.
          maxPoolSize: Number(config.get('MONGO_MAX_POOL_SIZE') ?? 10),
          minPoolSize: 1,
          connectionFactory: (connection: Connection) => {
            connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
            connection.on('reconnected', () => logger.log('MongoDB reconnected'));
            connection.on('error', (err: Error) => logger.error(`MongoDB error: ${err.name}`));
            return connection;
          },
        };
      },
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: RestaurantMember.name, schema: RestaurantMemberSchema },
      { name: Category.name, schema: CategorySchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Table.name, schema: TableSchema },
      { name: TableSession.name, schema: TableSessionSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: GroupOrder.name, schema: GroupOrderSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
