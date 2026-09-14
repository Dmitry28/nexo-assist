import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import type { User } from '@/modules/subscriptions/entities/user.entity';

/** Only the fields a spec ever sets; `user` is partial because specs need just its telegramId. */
type SubscriptionOverrides = Partial<Omit<Subscription, 'user'>> & { user?: Partial<User> };

/**
 * A Subscription for unit tests; override only what the test cares about.
 *
 * NOTE: `baselinedAt` is deliberately null by default — that is the "baseline still pending"
 * state, which is the branch a fresh subscription takes. Null and not absent, because that is
 * what a row loaded from Postgres holds; a double of a different shape hides real differences.
 */
export const makeSubscription = (overrides: SubscriptionOverrides = {}): Subscription =>
  ({
    id: 'sub-1',
    userId: 'user-1',
    user: { telegramId: 1 },
    source: 'kufar',
    url: 'https://kufar.by/l',
    baselinedAt: null,
    pausedAt: null,
    consecutiveFailures: 0,
    ...overrides,
  }) as Subscription;
