import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { PublicMenuController } from './public-menu.controller';
import { MenuImageRedirectController } from './menu-image-redirect.controller';
import { MenuService } from './menu.service';

@Module({
  controllers: [MenuController, PublicMenuController, MenuImageRedirectController],
  providers: [MenuService],
})
export class MenuModule {}
