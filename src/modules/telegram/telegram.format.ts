import type { BotCommand } from 'grammy/types';

import type { Listing } from '@/modules/sources/source-adapter';

/** Reusable "no link preview" message option. */
export const NO_LINK_PREVIEW = { is_disabled: true } as const;

// Shared char budget with headroom under Telegram's 4096-char message limit (an
// oversized send throws — and would then be rebuilt oversized and fail on every retry).
export const MAX_MESSAGE_BUDGET_CHARS = 3500;
// Digest item-count cap for readability.
// DIGEST_LIMIT is exported for specs; production callers get the delivered slice.
export const DIGEST_LIMIT = 10;
// Clamp a pathological listing — one huge line (long title OR link) must not eat the char
// budget, which would produce an item-less digest that delivers nothing and repeats forever.
// Exported for specs.
export const MAX_LINE_CHARS = 500;

/**
 * Cut `text` down to at most `max` chars, ellipsis included. Drops a trailing lone surrogate so
 * a cut landing inside an emoji doesn't leave half of it behind (listing titles carry emoji).
 */
const truncate = (text: string, max: number): string =>
  `${text.slice(0, Math.max(0, max - 1)).replace(/[\uD800-\uDBFF]$/, '')}…`;

function price(listing: Listing): string {
  if (listing.priceUsd !== undefined) return `$${listing.priceUsd}`;
  if (listing.priceByn !== undefined) return `${listing.priceByn} BYN`;
  return 'цена не указана';
}

function formatOne(listing: Listing): string {
  // Truncate the TITLE, never the link: the item is marked seen once delivered, so a listing
  // that arrives without its link is lost for good — the whole point of the message is gone.
  const tail = `\n${price(listing)}\n${listing.link}`;
  const titleBudget = MAX_LINE_CHARS - tail.length;
  const title =
    listing.title.length > titleBudget ? truncate(listing.title, titleBudget) : listing.title;
  const line = `${title}${tail}`;
  // Backstop for an absurdly long link, where trimming the title alone can't bring the line down.
  // Nothing useful survives such a link anyway; the cap keeps one item from starving the digest.
  return line.length > MAX_LINE_CHARS ? truncate(line, MAX_LINE_CHARS) : line;
}

/** A listings digest under `header`: items up to the caps, then a "…и ещё N" footer. */
function digest(listings: Listing[], header: string): { text: string; shown: Listing[] } {
  const lines: string[] = [];
  const shown: Listing[] = [];
  let length = header.length;
  for (const listing of listings) {
    const line = formatOne(listing);
    if (shown.length >= DIGEST_LIMIT || length + line.length > MAX_MESSAGE_BUDGET_CHARS) break;
    lines.push(line);
    shown.push(listing);
    length += line.length + '\n\n'.length;
  }
  const more = listings.length - shown.length;
  const footer = more > 0 ? `\n\n…и ещё ${more}` : '';
  return { text: `${header}\n\n${lines.join('\n\n')}${footer}`, shown };
}

export const formatCurrentListings = (listings: Listing[]): string =>
  listings.length === 0
    ? 'Сейчас объявлений нет.'
    : digest(listings, `📋 Объявлений сейчас: ${listings.length}`).text;

/**
 * The "new listings" digest plus the exact slice it shows. Callers must markSeen
 * only `delivered` — the overflow beyond the caps surfaces on a later run.
 * NOTE: newest-first means sustained volume > cap starves the oldest items; fixed
 * by batched delivery (Phase 7).
 */
export function newListingsDigest(fresh: Listing[]): { text: string; delivered: Listing[] } {
  const { text, shown } = digest(fresh, `🆕 Новых объявлений: ${fresh.length}`);
  return { text, delivered: shown };
}

/** Sent when a subscription is auto-paused because its URL kept failing. */
export const deadSubscriptionNotice = ({ source, url }: { source: string; url: string }): string =>
  `⚠️ Поиск на ${source} перестал отвечать — я поставил его на паузу.\n` +
  `Проверьте ссылку и пришлите её снова, если она рабочая.\n${url}`;

/**
 * The command menu Telegram shows under "≡". Admin-only commands stay out on purpose:
 * the menu is public and those commands ignore non-admins anyway.
 */
export const BOT_COMMANDS = [
  { command: 'start', description: 'Начать' },
  { command: 'list', description: 'Мои подписки' },
  { command: 'help', description: 'Что умеет бот' },
] as const satisfies readonly BotCommand[];

/** `/help` — built from BOT_COMMANDS so the menu and the text cannot drift apart. */
export const HELP_MESSAGE = [
  // TODO [L]: the source list is hardcoded here and in PROMPT — a third adapter would
  // leave both wrong. Derive it from SourceRegistry when that adapter lands.
  '🔎 Слежу за поиском на kufar.by и realt.by и присылаю новые объявления.',
  '',
  'Как начать: пришлите ссылку на поиск с уже выставленными фильтрами — предложу кнопку ' +
    '«Следить». Дальше проверяю раз в сутки и присылаю то, что появилось с прошлой ' +
    `проверки (пока до ${DIGEST_LIMIT} объявлений за раз).`,
  '',
  'Команды:',
  ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description.toLowerCase()}`),
  '',
  'Отписаться: /list, затем ❌ у нужного поиска.',
  '',
  'Данные: храню ваш telegram-id, имя, @username, язык интерфейса и ссылки, за которыми ' +
    'слежу, — только чтобы присылать уведомления. Хотите удалить — напишите владельцу бота.',
].join('\n');

/** Admin `/stats` snapshot. */
export const formatStats = (s: {
  users: number;
  active: number;
  paused: number;
  lastRunAt?: Date;
}): string =>
  [
    '📊 Статистика',
    `👥 пользователей: ${s.users}`,
    `📋 активных подписок: ${s.active}`,
    `⏸ на паузе: ${s.paused}`,
    `🕒 последний прогон: ${s.lastRunAt ? s.lastRunAt.toISOString() : 'не было'}`,
  ].join('\n');
