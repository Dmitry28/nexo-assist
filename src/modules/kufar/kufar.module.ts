import { Module } from '@nestjs/common';

import { KufarService } from './kufar.service';

@Module({
  providers: [KufarService],
  // No exports — add them only when another module actually injects KufarService.
})
export class KufarModule {}
