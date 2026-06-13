import type { Listing } from '@/modules/sources/source-adapter';

/** A normalized Listing for unit tests; override only what the test cares about. */
export const makeListing = (id: number, over: Partial<Listing> = {}): Listing => ({
  externalId: String(id),
  link: `https://re.kufar.by/vi/${id}`,
  title: `t${id}`,
  listTime: '2026-01-01T00:00:00Z',
  images: [],
  ...over,
});
