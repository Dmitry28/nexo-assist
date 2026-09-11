import * as Sentry from '@sentry/nestjs';

import { SourceUnavailableError } from '@/modules/sources/source-adapter';

/** How long to wait for a report to reach Sentry before a deliberate exit gives up on it. */
export const SENTRY_FLUSH_MS = 2000;

/** Where it broke — a Sentry tag to filter by. 'daily' is the scheduled run, not a user action. */
export type UserAction = 'subscribe' | 'check' | 'show-current' | 'bot-update' | 'daily';

/** Which operation failed. A closed set: a typo here silently empties a Sentry filter. */
export type ReportOp = 'poll' | 'deliver' | 'mark-seen' | 'process' | 'record-failure' | 'pause';

/**
 * Report an error that affects a user, with who and what attached.
 *
 * Logs alone don't scale past one user: they vanish when the pod restarts, and they can't answer
 * "how many people hit this?". Sentry groups identical failures and counts affected users, so the
 * owner sees one issue with "N users" instead of N log lines — and can reach out to those people.
 *
 * Tag vocabulary, one meaning each:
 *  - `kind` — whose fault: a source being down (not our bug, but its volume matters) vs a real
 *    defect. Derived from the error type, not its message, so it stays honest as messages change.
 *  - `action` — where it happened.
 *  - `op` — the failing operation, when `action` alone doesn't identify it.
 */
export function reportUserFacing(
  err: unknown,
  context: {
    userId?: number;
    action: UserAction;
    url?: string;
    op?: ReportOp;
    /** Extra fields for the "subscription" context block. */
    details?: Record<string, string | number>;
  },
): void {
  Sentry.withScope((scope) => {
    // Sentry counts distinct users per issue — this is what makes "20 people are stuck" visible.
    if (context.userId !== undefined) scope.setUser({ id: String(context.userId) });
    scope.setTag('action', context.action);
    scope.setTag('kind', err instanceof SourceUnavailableError ? 'source' : 'bug');
    if (context.op !== undefined) scope.setTag('op', context.op);
    const subscription = {
      ...context.details,
      ...(context.url !== undefined && { url: context.url }),
    };
    if (Object.keys(subscription).length > 0) scope.setContext('subscription', subscription);
    Sentry.captureException(err);
  });
}
