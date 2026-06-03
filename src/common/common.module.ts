import { Global, Module } from '@nestjs/common';

import { SnapshotService } from './snapshot.service';

/**
 * Shared infrastructure available app-wide.
 * Registered once with `@Global()` — feature modules do not need to import it.
 */
@Global()
@Module({
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class CommonModule {}
