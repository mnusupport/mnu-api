import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { CustomerRecognitionController } from './customer-recognition.controller';
import { CustomerRecognitionService } from './customer-recognition.service';

// Reuses the existing Customer model. Intentionally NOT imported by OrdersModule
// and does not import it: recognition and order creation stay independent.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
  ],
  controllers: [CustomerRecognitionController],
  providers: [CustomerRecognitionService],
})
export class CustomerRecognitionModule {}
