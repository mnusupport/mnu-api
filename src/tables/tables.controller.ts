import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { TablesService } from './tables.service';
import { TableStatus } from './schemas/table.schema';

@UseGuards(JwtAuthGuard)
@Controller('restaurants/:restaurantId/tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  list(@Param('restaurantId') restaurantId: string, @CurrentUserId() userId: string) {
    return this.tablesService.listTables(restaurantId, userId);
  }

  @Get(':tableId')
  get(
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.tablesService.getTable(restaurantId, tableId, userId);
  }

  @Post()
  create(
    @Param('restaurantId') restaurantId: string,
    @CurrentUserId() userId: string,
    @Body() body: { tableNumber: string; capacity: number; status?: TableStatus },
  ) {
    return this.tablesService.createTable(restaurantId, userId, body);
  }

  @Patch(':tableId')
  update(
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
    @CurrentUserId() userId: string,
    @Body() body: { tableNumber?: string; capacity?: number; status?: TableStatus },
  ) {
    return this.tablesService.updateTable(restaurantId, tableId, userId, body);
  }

  @Delete(':tableId')
  remove(
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.tablesService.deleteTable(restaurantId, tableId, userId);
  }
}
