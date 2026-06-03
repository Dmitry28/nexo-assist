import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const isErrnoException = (e: unknown): e is NodeJS.ErrnoException =>
  e instanceof Error && 'code' in e;

/**
 * Generic JSON-array snapshot persistence for diff-based subscription modules.
 *
 * Read/write a typed `T[]` to disk; the caller passes a type-guard so the
 * stored shape is validated on every read. Used as the state layer for the
 * scrape → diff → notify → persist pattern (see docs/llm/rules/architecture.md).
 *
 * - Missing or corrupt snapshots are silently reset (treated as empty) — losing
 *   state degrades to "everything looks new", which is recoverable; throwing
 *   would block every subsequent run.
 * - Writes are atomic via tmp+rename so a crash mid-write never corrupts the
 *   live snapshot.
 */
@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  async read<T>(filePath: string, isValid: (item: unknown) => item is T): Promise<T[]> {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(data);
      if (!Array.isArray(parsed)) {
        this.logger.warn(`Snapshot at ${filePath} is not an array, resetting.`);
        return [];
      }
      if (!parsed.every(isValid)) {
        this.logger.warn(`Snapshot at ${filePath} has unexpected shape, resetting.`);
        return [];
      }
      return parsed;
    } catch (error: unknown) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        this.logger.log(`No snapshot at ${filePath}, starting fresh.`);
      } else if (error instanceof SyntaxError) {
        this.logger.error(`Snapshot at ${filePath} contains invalid JSON — resetting.`, error);
      } else {
        this.logger.error(`Failed to read snapshot at ${filePath}, starting fresh.`, error);
      }
      return [];
    }
  }

  async write<T>(filePath: string, items: T[]): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `${path.basename(filePath)}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(items, null, 2));
    await fs.rename(tmp, filePath);
  }
}
