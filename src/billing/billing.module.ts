import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Restaurant } from '../restaurants/schemas/restaurant.schema';
import { RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { RestaurantBill, RestaurantBillSchema, RestaurantInvoiceCounter, RestaurantInvoiceCounterSchema } from './schemas/bill.schema';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Restaurant.name, schema: RestaurantSchema },
    { name: Order.name, schema: OrderSchema },
    { name: RestaurantBill.name, schema: RestaurantBillSchema },
    { name: RestaurantInvoiceCounter.name, schema: RestaurantInvoiceCounterSchema },
  ])],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
