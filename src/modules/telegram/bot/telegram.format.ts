import type { BotCommand } from 'grammy/types';

import type { Listing } from '@/modules/sources/source-adapter';

/** Reusable "no link preview" message option. */
export const NO_LINK_PREVIEW = { is_disabled: true } as const;

// Shared char budget with headroom under Telegram's 4096-char message limit (an
// oversized send throws — and would then be rebuilt oversized and fail on every retry).
export const MAX_MESSAGE_BUDGET_CHARS = 3500;
// Items per message, for readability; MAX_LISTINGS_PER_DELIVERY caps the whole delivery.
export const DIGEST_LIMIT = 10;
// Clamp a pathological listing — one huge line (long title OR link) must not eat the char
// budget, which would produce an item-less digest that delivers nothing and repeats forever.
// Exported for specs.
export const MAX_LINE_CHARS = 500;

/**
 * Cut `text` down to at most `max` chars, ellipsis included. Drops a trailing lone surrogate so
 * a cut landing inside an emoji doesn't leave half of it behind (listing titles carry emoji).
 */
const truncate = (text: string, max: number): string => {
  // A non-positive budget has no room even for the ellipsis — returning '…' would exceed `max`.
  if (max <= 0) return '';
  return `${text.slice(0, Math.max(0, max - 1)).replace(/[\uD800-\uDBFF]$/, '')}…`;
};

function price(listing: Listing): string {
  if (listing.priceUsd !== undefined) return `$${listing.priceUsd}`;
  if (listing.priceByn !== undefined) return `${listing.priceByn} BYN`;
  return 'цена не указана';
}

function formatOne(listing: Listing): string {
  // Truncate the TITLE first and keep the link whole: the item is marked seen once delivered, so
  // a listing that arrives without its link is lost for good. Only when trimming the title still
  // can't fit the line does the backstop below cut the whole line, link included.
  const tail = `\n${price(listing)}\n${listing.link}`;
  const titleBudget = MAX_LINE_CHARS - tail.length;
  const title =
    listing.title.length > titleBudget ? truncate(listing.title, titleBudget) : listing.title;
  const line = `${title}${tail}`;
  // Backstop for an absurdly long link, where trimming the title alone can't bring the line down.
  // Nothing useful survives such a link anyway; the cap keeps one item from starving the digest.
  return line.length > MAX_LINE_CHARS ? truncate(line, MAX_LINE_CHARS) : line;
}

/**
 * As many listings as fit `budget` chars (and DIGEST_LIMIT items). Always takes at least one:
 * formatOne clamps a line to MAX_LINE_CHARS, which is far below any budget we pass — so callers
 * that loop over the remainder always make progress.
 */
function takeChunk(listings: Listing[], budget: number): Listing[] {
  const shown: Listing[] = [];
  let length = 0;
  for (const listing of listings) {
    if (shown.length >= DIGEST_LIMIT) break;
    const line = formatOne(listing);
    if (shown.length > 0 && length + line.length > budget) break;
    shown.push(listing);
    length += line.length + '\n\n'.length;
  }
  return shown;
}

/**
 * One message: header, blank line, the formatted items, an optional footer. Both digest builders
 * assemble the same shape, and the separator is load-bearing — takeChunk measures the budget with
 * `'\n\n'.length` between items, so a change here has to be a change there.
 */
function compose(header: string, listings: Listing[], footer = ''): string {
  return `${header}\n\n${listings.map(formatOne).join('\n\n')}${footer}`;
}

/** A listings digest under `header`: items up to the caps, then a "…и ещё N" footer. */
// TODO [L]: the budget subtracts only `header.length` and ignores the "…и ещё N" footer, which
// newListingsBatches reserves HEADER_TAIL_RESERVE_CHARS for. Safe only thanks to the 596-char
// slack under Telegram's 4096; reserve the footer too before MAX_MESSAGE_BUDGET_CHARS is raised.
function digest(listings: Listing[], header: string): { text: string; shown: Listing[] } {
  const shown = takeChunk(listings, MAX_MESSAGE_BUDGET_CHARS - header.length);
  const more = listings.length - shown.length;
  const footer = more > 0 ? `\n\n…и ещё ${more}` : '';
  return { text: compose(header, shown, footer), shown };
}

export const formatCurrentListings = (listings: Listing[]): string =>
  listings.length === 0
    ? 'Сейчас объявлений нет.'
    : digest(listings, `📋 Объявлений сейчас: ${listings.length}`).text;

// Ceiling on one delivery. Beyond it the rest waits for the next run: a hundred listings is
// already more than anyone reads at once, and it bounds the burst we send into one chat.
export const MAX_LISTINGS_PER_DELIVERY = 100;

// Room the header ("🆕 Новых объявлений: 103 (10/10)") and the deferred-tail line need, since
// both are added after the listings are chunked.
const HEADER_TAIL_RESERVE_CHARS = 120;

/** One message of a batched digest and the listings it carries. */
export interface DigestBatch {
  text: string;
  listings: Listing[];
}

/**
 * Split fresh listings into messages instead of cutting at the first cap: everything up to
 * MAX_LISTINGS_PER_DELIVERY is sent, the remainder is announced rather than dropped silently.
 * Callers must markSeen only the batches that were actually sent.
 */
export function newListingsBatches(fresh: Listing[]): DigestBatch[] {
  const sending = fresh.slice(0, MAX_LISTINGS_PER_DELIVERY);
  const later = fresh.length - sending.length;

  const chunks: Listing[][] = [];
  let rest = sending;
  while (rest.length > 0) {
    // Reserve room for the header and the tail, which are added after chunking — otherwise the
    // measured string is not the string sent, and an oversized message fails on every retry.
    const chunk = takeChunk(rest, MAX_MESSAGE_BUDGET_CHARS - HEADER_TAIL_RESERVE_CHARS);
    chunks.push(chunk);
    rest = rest.slice(chunk.length);
  }

  return chunks.map((listings, i) => {
    const part = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';
    const header = `🆕 Новых объявлений: ${fresh.length}${part}`;
    const tail =
      later > 0 && i === chunks.length - 1
        ? `\n\n…и ещё ${later} — пришлю в следующую проверку`
        : '';
    return { text: compose(header, listings, tail), listings };
  });
}

/** Sent when a subscription is auto-paused because its URL kept failing. */
export const deadSubscriptionNotice = ({ source, url }: { source: string; url: string }): string =>
  `⚠️ Поиск на ${source} перестал отвечать — я поставил его на паузу.\n` +
  `Проверьте ссылку и пришлите её снова, если она рабочая.\n${url}`;

// NOTE: user-facing text is Russian — the beta audience is the kufar.by/realt.by one.
// Per-profile language: PRODUCT_PLAN.md § Фаза 7 «i18n».
export const PROMPT =
  'Пришлите ссылку на поиск с kufar.by или realt.by — буду следить за новыми объявлениями.';

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
    `проверки — до ${MAX_LISTINGS_PER_DELIVERY} за раз, несколькими сообщениями.`,
  '',
  'Команды:',
  ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description.toLowerCase()}`),
  '',
  'В /list: ❌ — удалить поиск, ⏸ — он на паузе (не отвечал), ▶️ — вернуть его в работу.',
  '',
  'Данные: храню ваш telegram-id, имя, @username, язык интерфейса и ссылки, за которыми ' +
    'слежу, — только чтобы присылать уведомления. Хотите удалить — напишите владельцу бота.',
].join('\n');

/** Admin `/stats` snapshot. */
export const formatStats = (stats: {
  users: number;
  active: number;
  paused: number;
  lastRunAt?: Date;
}): string =>
  [
    '📊 Статистика',
    `👥 пользователей: ${stats.users}`,
    `📋 активных подписок: ${stats.active}`,
    `⏸ на паузе: ${stats.paused}`,
    `🕒 последний успешный прогон: ${stats.lastRunAt ? stats.lastRunAt.toISOString() : 'не было'}`,
  ].join('\n');
