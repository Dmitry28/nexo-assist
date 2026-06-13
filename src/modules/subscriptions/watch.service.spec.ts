import type { KufarListing } from '@/modules/kufar/entities/kufar-listing.entity';
import { KufarService } from '@/modules/kufar/kufar.service';

import { SubscriptionsService } from './subscriptions.service';
import { WatchService } from './watch.service';

const listing = (adId: number): KufarListing => ({
  adId,
  link: `https://re.kufar.by/vi/${adId}`,
  title: `t${adId}`,
  listTime: '2026-01-01T00:00:00Z',
  images: [],
});

describe('WatchService', () => {
  let subs: SubscriptionsService;
  let kufar: KufarService;
  let watch: WatchService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    subs = new SubscriptionsService();
    kufar = new KufarService();
    fetchSpy = jest.spyOn(kufar, 'fetch');
    watch = new WatchService(subs, kufar);
  });

  const addKufar = () =>
    subs.add({ telegramUserId: 1, source: 'kufar', url: 'https://kufar.by/l/x' });

  it('baseline seeds seen so an immediate check finds nothing new', async () => {
    const sub = addKufar();
    fetchSpy.mockResolvedValue([listing(1), listing(2)]);

    const result = await watch.baseline(sub);
    const fresh = await watch.check(sub);

    expect(result).toEqual({ supported: true, count: 2 });
    expect(fresh).toEqual([]);
  });

  it('check returns only listings not seen before', async () => {
    const sub = addKufar();
    fetchSpy.mockResolvedValueOnce([listing(1)]);
    await watch.baseline(sub);
    fetchSpy.mockResolvedValueOnce([listing(1), listing(2)]);

    const fresh = await watch.check(sub);

    expect(fresh.map((l) => l.adId)).toEqual([2]);
  });

  it('treats realt as unsupported without fetching', async () => {
    const sub = subs.add({ telegramUserId: 1, source: 'realt', url: 'https://realt.by/x' });

    expect(await watch.baseline(sub)).toEqual({ supported: false, count: 0 });
    expect(await watch.check(sub)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
