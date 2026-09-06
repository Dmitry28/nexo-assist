import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import type { User } from '@/modules/subscriptions/entities/user.entity';

/** Only the fields a spec ever sets; `user` is partial because specs need just its telegramId. */
type SubscriptionOverrides = Partial<Omit<Subscription, 'user'>> & { user?: Partial<User> };

/**
 * A Subscription for unit tests; override only what the test cares about.
 *
 * NOTE: `baselinedAt` is deliberately absent by default — that is the "baseline still pending"
 * state, which is the branch a fresh subscription takes.
 */
export const makeSubscription = (overrides: SubscriptionOverrides = {}): Subscription =>
  ({
    id: 'sub-1',
    userId: 'user-1',
    user: { telegramId: 1 },
    source: 'kufar',
    url: 'https://kufar.by/l',
    pausedAt: null,
    consecutiveFailures: 0,
    ...overrides,
  }) as Subscription;
