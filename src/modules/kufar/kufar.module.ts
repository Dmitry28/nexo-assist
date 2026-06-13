import { Module } from '@nestjs/common';

import { KufarService } from './kufar.service';

@Module({
  providers: [KufarService],
  exports: [KufarService],
})
export class KufarModule {}
