import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Restaurant, RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { Table, TableSchema } from '../tables/schemas/table.schema';
import { TableSessionsController } from './table-sessions.controller';
import { TableSessionsService } from './table-sessions.service';
import { TableSession, TableSessionSchema } from './schemas/table-session.schema';

@Module({
  imports: [
    // DatabaseModule already registers these globally; re-listing them
    // here keeps this module's model dependencies explicit — same
    // convention TablesModule/AuthModule already use.
    MongooseModule.forFeature([
      { name: TableSession.name, schema: TableSessionSchema },
      { name: Table.name, schema: TableSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
  ],
  controllers: [TableSessionsController],
  providers: [TableSessionsService],
})
export class TableSessionsModule {}
