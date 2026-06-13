import { Module } from '@nestjs/common';

import { TelegramService } from './telegram.service';

@Module({
  providers: [TelegramService],
  // No exports — add them only when another module actually injects TelegramService.
})
export class TelegramModule {}
