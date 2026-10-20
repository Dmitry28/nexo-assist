import { watchedItem } from '@/modules/sources/sources';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import { readKeywords } from '@/modules/subscriptions/keyword-filter';

import { escapeHtml } from './listing-card';
import { MAX_MESSAGE_BUDGET_CHARS, searchLabel } from './telegram.format';

/**
 * /list number buttons at most — Telegram rejects an inline keyboard of ~100+ buttons, and a
 * rejected reply costs the user /list, their only way to remove a subscription. The cap on 50
 * counts active subscriptions only, so paused ones can push a user past it.
 */
export const MAX_LIST_BUTTONS = 90;

/** What /list and a subscription's menu need of a subscription. */
type ListedSubscription = Pick<Subscription, 'source' | 'url' | 'pausedAt' | 'keywords'>;

const linkedLabel = (sub: ListedSubscription): string =>
  `<a href="${escapeHtml(sub.url)}">${escapeHtml(searchLabel(sub))}</a>`;

const filterLine = (sub: ListedSubscription): string | undefined => {
  const phrases = readKeywords(sub.keywords);
  return phrases ? `🔎 ${escapeHtml(phrases.join(' · '))}` : undefined;
};

/**
 * /list as HTML: one short line per subscription — its label linking to the search, ⏸ when
 * paused, its filter under it — then as many as fit MAX_MESSAGE_BUDGET_CHARS of visible text
 * (a link's address is not counted by Telegram) and MAX_LIST_BUTTONS. `shown` is how many made
 * it, for the buttons.
 */
export function formatSubscriptionList(subs: ListedSubscription[]): {
  text: string;
  shown: number;
} {
  const header = `Ваши подписки (${subs.length}):`;
  const footer = 'Нажмите номер — удалить, задать фильтр, возобновить.';
  const lines: string[] = [];
  let visible = header.length + footer.length;
  for (const [i, sub] of subs.entries()) {
    const head = `#${i + 1} ${searchLabel(sub)}${sub.pausedAt ? ' ⏸' : ''}`;
    const filter = filterLine(sub);
    const cost = head.length + (filter?.length ?? 0) + 2;
    if (visible + cost > MAX_MESSAGE_BUDGET_CHARS || i === MAX_LIST_BUTTONS) {
      lines.push(`…и ещё ${subs.length - i} — удалите часть, чтобы увидеть остальные`);
      return { text: [header, lines.join('\n'), footer].join('\n\n'), shown: i };
    }
    visible += cost;
    lines.push(
      [`#${i + 1} ${linkedLabel(sub)}${sub.pausedAt ? ' ⏸' : ''}`, filter]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return { text: [header, lines.join('\n'), footer].join('\n\n'), shown: subs.length };
}

/** One subscription's menu as HTML: what it watches, whether it is paused, its filter. */
export const formatSubscriptionMenu = (sub: ListedSubscription, number: number): string =>
  [
    `#${number} ${linkedLabel(sub)}${sub.pausedAt ? ' ⏸ на паузе' : ''}`,
    filterLine(sub) ??
      (watchedItem(sub.source, sub.url) ? undefined : '🔎 Фильтра нет — приходит всё'),
  ]
    .filter(Boolean)
    .join('\n');
