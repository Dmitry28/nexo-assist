import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  beforeEach(() => {
    service = new SubscriptionsService();
  });

  it('adds and lists subscriptions per user', () => {
    service.add({ telegramUserId: 1, source: 'kufar', url: 'https://kufar.by/l/a' });
    service.add({ telegramUserId: 2, source: 'realt', url: 'https://realt.by/b' });

    const mine = service.listByUser(1);

    expect(mine).toHaveLength(1);
    expect(mine[0].url).toBe('https://kufar.by/l/a');
    expect(mine[0].id).toBeDefined();
  });

  it('removes only the owner’s subscription', () => {
    const sub = service.add({ telegramUserId: 1, source: 'kufar', url: 'https://kufar.by/l/a' });

    expect(service.remove(sub.id, 2)).toBe(false);
    expect(service.remove(sub.id, 1)).toBe(true);
    expect(service.listByUser(1)).toHaveLength(0);
  });

  it('returns false when removing a missing subscription', () => {
    expect(service.remove('missing', 1)).toBe(false);
  });
});
