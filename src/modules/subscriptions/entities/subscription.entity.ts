import type { SourceId } from '@/modules/sources/source-adapter';

/** A user's request to watch one search URL. In-memory for now. */
export interface Subscription {
  id: string;
  telegramUserId: number;
  source: SourceId;
  url: string;
  createdAt: Date;
}
