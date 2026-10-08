import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { CustomerRecognitionController } from './customer-recognition.controller';
import { CustomerRecognitionService } from './customer-recognition.service';

// Reuses the existing Customer model. The recognition service is exported so
// public order endpoints can optionally resolve an existing recognition token
// without making customer recognition mandatory for order creation.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
  ],
  controllers: [CustomerRecognitionController],
  providers: [CustomerRecognitionService],
  exports: [CustomerRecognitionService],
})
export class CustomerRecognitionModule {}
