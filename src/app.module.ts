import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { MenuModule } from './menu/menu.module';
import { TablesModule } from './tables/tables.module';
import { TableSessionsModule } from './table-sessions/table-sessions.module';
import { OrdersModule } from './orders/orders.module';
import { GroupOrdersModule } from './group-orders/group-orders.module';
import { CustomerRecognitionModule } from './customers/customer-recognition.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { AuthorizationModule } from './common/authorization.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    MenuModule,
    TablesModule,
    TableSessionsModule,
    OrdersModule,
    GroupOrdersModule,
    CustomerRecognitionModule,
    RestaurantsModule,
    AuthorizationModule,
    PlatformAdminModule,
    AuditModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
