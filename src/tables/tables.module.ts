import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Table, TableSchema } from './schemas/table.schema';
import { RestaurantMember, RestaurantMemberSchema } from '../restaurant-members/schemas/restaurant-member.schema';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';

@Module({
  imports: [
    // DatabaseModule already registers these globally, but importing them
    // here too is harmless (Mongoose dedupes by name) and keeps this
    // module's model dependencies explicit — same convention AuthModule
    // already uses.
    MongooseModule.forFeature([
      { name: Table.name, schema: TableSchema },
      { name: RestaurantMember.name, schema: RestaurantMemberSchema },
    ]),
  ],
  controllers: [TablesController],
  providers: [TablesService],
})
export class TablesModule {}
