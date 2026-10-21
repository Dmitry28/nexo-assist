import type { BotCommand } from 'grammy/types';

import { LOCALE } from '@/common/locale';
import { UnsupportedSearchError } from '@/modules/sources/source-adapter';
import type { Listing, UnwatchableItemError } from '@/modules/sources/source-adapter';
import { SOURCES, siteName, watchedItem } from '@/modules/sources/sources';
import type { Removal } from '@/modules/subscriptions/findings';
import type { PriceChange } from '@/modules/subscriptions/price-change';

/** Reusable "no link preview" message option. */
export const NO_LINK_PREVIEW = { is_disabled: true } as const;

// Shared char budget with headroom under Telegram's 4096-char message limit (an
// oversized send throws — and would then be rebuilt oversized and fail on every retry).
export const MAX_MESSAGE_BUDGET_CHARS = 3500;
// Items per digest message, for readability; CARDS_PER_DELIVERY decides what is a card at all.
export const DIGEST_LIMIT = 10;
// Clamp a pathological listing — one huge line (long title OR link) must not eat the char
// budget, which would produce an item-less digest that delivers nothing and repeats forever.
// Exported for specs.
export const MAX_LINE_CHARS = 500;

/**
 * Cut `text` down to at most `max` chars, ellipsis included. Drops a trailing lone surrogate so
 * a cut landing inside an emoji doesn't leave half of it behind (listing titles carry emoji).
 *
 * `dropTrailing` removes one more thing the cut may have landed inside — the card passes it the
 * shape of a half-written HTML entity (listing-card.ts), which would break the whole message.
 */
export const truncate = (text: string, max: number, dropTrailing?: RegExp): string => {
  // A non-positive budget has no room even for the ellipsis — returning '…' would exceed `max`.
  if (max <= 0) return '';
  const cut = text.slice(0, Math.max(0, max - 1)).replace(/[\uD800-\uDBFF]$/, '');
  return `${dropTrailing === undefined ? cut : cut.replace(dropTrailing, '')}…`;
};

// One currency keeps the compact line short; the grouping matches the cards in the same delivery
// (listing-card.ts formatPrice), which otherwise print the same number two ways.
function price(listing: Pick<Listing, 'priceText' | 'priceByn' | 'priceUsd'>): string {
  if (listing.priceText !== undefined) return listing.priceText;
  if (listing.priceUsd !== undefined) return `$${listing.priceUsd.toLocaleString(LOCALE)}`;
  if (listing.priceByn !== undefined) return `${listing.priceByn.toLocaleString(LOCALE)} BYN`;
  return 'цена не указана';
}

/** One digest item: title, a price line, link. */
function formatItem({
  title,
  price,
  link,
}: {
  title: string;
  price: string;
  link: string;
}): string {
  // Truncate the TITLE first and keep the link whole: the item is marked seen once delivered, so
  // a listing that arrives without its link is lost for good. Only when trimming the title still
  // can't fit the line does the backstop below cut the whole line, link included.
  const tail = `\n${price}\n${link}`;
  const titleBudget = MAX_LINE_CHARS - tail.length;
  const shown = title.length > titleBudget ? truncate(title, titleBudget) : title;
  const line = `${shown}${tail}`;
  // Backstop for an absurdly long link, where trimming the title alone can't bring the line down.
  // Nothing useful survives such a link anyway; the cap keeps one item from starving the digest.
  return line.length > MAX_LINE_CHARS ? truncate(line, MAX_LINE_CHARS) : line;
}

const formatListing = (listing: Listing): string =>
  formatItem({ title: listing.title, price: price(listing), link: listing.link });

type Prices = Pick<Listing, 'priceByn' | 'priceUsd'>;

// Both sides in a currency both carry — `price` picks one per listing, and «1 000 BYN → $300»
// reads as nonsense. Numbers only: the change was measured on them, not on a text price.
function inOneCurrency(before: Prices, after: Prices): [Prices, Prices] {
  if (before.priceUsd !== undefined && after.priceUsd !== undefined) {
    return [{ priceUsd: before.priceUsd }, { priceUsd: after.priceUsd }];
  }
  if (before.priceByn !== undefined && after.priceByn !== undefined) {
    return [{ priceByn: before.priceByn }, { priceByn: after.priceByn }];
  }
  return [before, { priceByn: after.priceByn, priceUsd: after.priceUsd }];
}

function formatPriceChange({ before, after }: PriceChange): string {
  const [was, now] = inOneCurrency(before, after);
  return formatItem({
    title: after.title,
    price: `${price(was)} → ${price(now)}`,
    link: after.link,
  });
}

const formatRemoval = ({ last }: Removal): string =>
  formatItem({ title: last.title, price: price(last), link: last.link });

/**
 * As many items as fit `budget` chars (and DIGEST_LIMIT items). Always takes at least one:
 * formatItem clamps a line to MAX_LINE_CHARS, which is far below any budget we pass — so callers
 * that loop over the remainder always make progress.
 */
function takeChunk<T>(items: T[], budget: number, format: (item: T) => string): T[] {
  const shown: T[] = [];
  let length = 0;
  for (const item of items) {
    if (shown.length >= DIGEST_LIMIT) break;
    const line = format(item);
    if (shown.length > 0 && length + line.length > budget) break;
    shown.push(item);
    length += line.length + '\n\n'.length;
  }
  return shown;
}

/**
 * One message: header, blank line, the formatted items, an optional footer. Every digest builder
 * assembles the same shape, and the separator is load-bearing — takeChunk measures the budget with
 * `'\n\n'.length` between items, so a change here has to be a change there.
 */
function compose<T>(header: string, items: T[], format: (item: T) => string, footer = ''): string {
  return `${header}\n\n${items.map(format).join('\n\n')}${footer}`;
}

/** A listings digest under `header`: items up to the caps, then a "…и ещё N" footer. */
// TODO [L]: the budget subtracts only `header.length` and ignores the "…и ещё N" footer, which
// tailBatches reserves HEADER_RESERVE_CHARS for. Safe only thanks to the 596-char slack under
// Telegram's 4096; reserve the footer too before MAX_MESSAGE_BUDGET_CHARS is raised.
function digest(listings: Listing[], header: string): { text: string; shown: Listing[] } {
  const shown = takeChunk(listings, MAX_MESSAGE_BUDGET_CHARS - header.length, formatListing);
  const more = listings.length - shown.length;
  const footer = more > 0 ? `\n\n…и ещё ${more}` : '';
  return { text: compose(header, shown, formatListing, footer), shown };
}

export const formatCurrentListings = (listings: Listing[]): string =>
  listings.length === 0
    ? 'Сейчас объявлений нет.'
    : digest(listings, `📋 Объявлений сейчас: ${listings.length}`).text;

/**
 * How many listings of one delivery go out as full cards, the rest as a digest.
 *
 * Thirty cards is around half a minute of paced sending to one chat; a hundred would be minutes
 * and would start tripping Telegram's per-chat limit, and a run walks subscriptions one after
 * another while holding the polling slot.
 */
export const CARDS_PER_DELIVERY = 30;

// Room the header ("🆕 Ещё объявлений: 103 (10/10)") needs, since it is added after the
// listings are chunked.
const HEADER_RESERVE_CHARS = 120;

/** One message of a batched digest and the items it carries. */
export interface DigestBatch<T> {
  text: string;
  items: T[];
}

/**
 * Items as however many digest messages they take, every one headed `title(count)` plus the part
 * number and the search label. Callers must record only the batches that were actually sent.
 */
function batches<T>(
  items: T[],
  { title, format, search }: { title: string; format: (item: T) => string; search?: string },
): DigestBatch<T>[] {
  const label = search === undefined ? '' : `\n${search}`;
  const chunks: T[][] = [];
  let rest = items;
  while (rest.length > 0) {
    // Reserve room for the header (counter line plus the search label), added after chunking —
    // otherwise the measured string is not the string sent, and an oversized message fails on
    // every retry.
    const chunk = takeChunk(rest, MAX_MESSAGE_BUDGET_CHARS - HEADER_RESERVE_CHARS, format);
    chunks.push(chunk);
    rest = rest.slice(chunk.length);
  }
  return chunks.map((chunk, i) => {
    const part = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';
    return {
      text: compose(`${title}: ${items.length}${part}${label}`, chunk, format),
      items: chunk,
    };
  });
}

/**
 * The listings past the card limit, as compact digest messages.
 *
 * Everything found in the run goes out in the run: the cards carry the first
 * CARDS_PER_DELIVERY and this carries the rest, so nothing is deferred to "the next check" —
 * a promise the page window could not keep, since a deferred tail can age out of it and be
 * lost (PRODUCT_PLAN.md § Технический бэклог).
 */
export const tailBatches = (listings: Listing[], search?: string): DigestBatch<Listing>[] =>
  batches(listings, { title: '🆕 Ещё объявлений', format: formatListing, search });

/** Price changes on listings already delivered: title, `old → new`, link. */
export const priceChangeBatches = (
  changes: PriceChange[],
  search?: string,
): DigestBatch<PriceChange>[] =>
  batches(changes, { title: '💸 Цена изменилась', format: formatPriceChange, search });

/** Delivered listings gone from their sale list — or a watched listing gone: title, last price, link. */
export const removalBatches = (
  removed: Removal[],
  search?: string,
  isItem?: boolean,
): DigestBatch<Removal>[] =>
  batches(removed, {
    title: isItem ? '🚫 Объявление снято — больше не слежу' : '🚫 Снято с продажи',
    format: formatRemoval,
    search,
  });

/** Longest path a label will show. In a card the header shares the caption budget with the
 *  listing itself; in a digest it is a line of its own. */
export const MAX_LABEL_CHARS = 40;

/**
 * A short name for the search a delivery came from, e.g. «kufar · grodno/kupit/dom».
 *
 * A reader can hold up to MAX_SUBSCRIPTIONS_PER_USER searches, and until now a card said only
 * what was found, never which search found it. The path is the cheapest honest answer: it is
 * what the reader picked on the site, in their own words, and it needs no knowledge of any
 * particular source. Single-character segments are dropped — kufar's `/l/` prefix and its like
 * carry nothing for a reader. Naming a subscription by hand is the natural upgrade and would
 * replace this (PRODUCT_PLAN.md § Фаза 7).
 */
export function searchLabel({ source, url }: { source: string; url: string }): string {
  const site = siteName(source);
  // A watched listing has no search path to show — its id names it.
  const item = watchedItem(source, url);
  if (item) return `${site} · объявление ${item.id}`;
  let path: string;
  try {
    path = new URL(url).pathname
      .split('/')
      .filter((segment) => segment.length > 1)
      // Percent-decoded for readability (Cyrillic paths arrive encoded). Inside the try on
      // purpose: `decodeURIComponent` throws URIError on a lone `%`, which realt paths really
      // can carry, and that would abort the delivery of a subscription that polled just fine.
      .map(decodeURIComponent)
      .join('/');
  } catch {
    // A stored URL that no longer parses — or decodes — is not worth failing a delivery over:
    // the source name alone still tells the reader more than nothing.
    return site;
  }
  if (path === '') return site;
  // `truncate` always appends the ellipsis — deciding there is something to cut is the caller's
  // job (see its docblock), so a path that fits must not go through it.
  const shown = path.length > MAX_LABEL_CHARS ? truncate(path, MAX_LABEL_CHARS) : path;
  return `${site} · ${shown}`;
}

/** The site swapped the pasted search for another one, so it cannot be watched (realt `addressV2`). */
export const searchRewrittenNotice = ({ from, to }: { from: string; to: string }): string =>
  `Не могу следить за этой ссылкой:\n${from}\n\n` +
  `Сайт подменяет её другим, более широким поиском:\n${to}\n\n` +
  'Обычно так делает фильтр адреса. Выберите город или район в самом разделе сайта (не в ' +
  'фильтре), откройте поиск и пришлите ссылку снова.';

/** bid.cars is closed and the leftover filters have no Copart/IAAI equivalent. */
const unsupportedSearchNotice = ({
  url,
  params,
}: {
  url: string;
  params: readonly string[];
}): string =>
  `Не могу следить за этой ссылкой:\n${url}\n\n` +
  `Фильтры (${params.join(', ')}) с bid.cars на аукционы не переводятся. ` +
  'Уберите их в поиске или пришлите ссылку copart.com / iaai.com.';

/** Why a link cannot be watched as sent — the refusal on subscribe and the daily run's pause both
 *  say it. */
export const unwatchableNotice = (
  err: UnsupportedSearchError | UnwatchableItemError,
  { source, url }: { source: string; url: string },
): string =>
  err instanceof UnsupportedSearchError
    ? unsupportedSearchNotice({ url, params: err.params })
    : `За таким объявлением на ${siteName(source)} пока не слежу — пришлите ссылку на поиск.\n${url}`;

/** A link to a site we do not read — its request filed (SourceRequestsService), or not. */
export const SITE_REQUESTED =
  'Спасибо! Этот сайт пока не поддерживается — я передал заявку на его добавление и сообщу вам, ' +
  'как только он появится.';
export const PAGE_UNSUPPORTED =
  'Этот сайт я поддерживаю, но не такую страницу — какие ссылки подходят, сказано в /help.';
export const SITE_UNSUPPORTED =
  'К сожалению, этот сайт пока не поддерживается. Список сайтов, с которыми я работаю, — в /help.';

/** Sent once a site the user asked for is supported — they resend the link to subscribe. */
export const sourceAddedNotice = ({ host, url }: { host: string; url: string }): string =>
  `✅ Хорошая новость: теперь я умею следить за ${host}, который вы просили добавить. Пришлите ` +
  `ссылку на поиск ещё раз — и я начну следить:\n${url}`;

/** Sent when a subscription is auto-paused because its URL kept failing. */
export const deadSubscriptionNotice = ({ source, url }: { source: string; url: string }): string =>
  `⚠️ Поиск на ${siteName(source)} перестал отвечать — я поставил его на паузу.\n` +
  `Проверьте ссылку и пришлите её снова, если она рабочая.\n${url}`;

// NOTE: user-facing text is Russian — the beta audience is the kufar.by/realt.by one.
// Per-profile language: PRODUCT_PLAN.md § Фаза 7 «i18n».
// Built from the registered sources, so a new one appears here without an edit. One line each, in
// /help only: a prompt listing hundreds of sites would bury the instruction it carries.
const SITES = SOURCES.map((source) => `• ${source.host} — ${source.about}`).join('\n');

export const PROMPT =
  'Пришлите ссылку на поиск с поддерживаемого сайта (список — в /help) — буду следить за ' +
  'новыми объявлениями.';

export const NO_SUBSCRIPTIONS = `Пока нет ни одной подписки. ${PROMPT}`;

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
  '🔎 Слежу за поиском на сайтах ниже и присылаю новые объявления.',
  SITES,
  '',
  'Как начать: пришлите ссылку на поиск с уже выставленными фильтрами — предложу кнопку ' +
    '«Следить». Дальше проверяю раз в сутки и присылаю то, что появилось с прошлой ' +
    `проверки: карточкой на каждое объявление (с фото, если они есть), а если их больше ${CARDS_PER_DELIVERY} — ` +
    'остальные компактным списком.',
  '',
  'Команды:',
  ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description.toLowerCase()}`),
  '',
  'Если неделю нового нет, пришлю короткое «пока нет» — чтобы было видно, что я работаю.',
  '',
  'В /list нажмите номер подписки: ❌ — удалить, 🔎 — фильтр по словам (присылать только ' +
    'объявления с ними), ▶️ — вернуть в работу подписку на паузе (⏸).',
  '',
  'Данные: храню ваш telegram-id, имя, @username, язык интерфейса, ссылки, за которыми ' +
    'слежу, и ссылки на сайты, которые вы просили добавить, — только чтобы присылать ' +
    'уведомления. Хотите удалить — напишите владельцу бота.',
].join('\n');

/**
 * The weekly «still watching» note for a user who heard nothing for a while (watch.scheduler.ts
 * § reportQuiet). No «за неделю»: the gap can be a month, or a search added two days ago.
 * Plain text, like the digest.
 */
export const quietReport = (subs: { source: string; url: string }[]): string =>
  [
    '🔕 Новых объявлений пока нет. Проверяю каждый день — напишу, как только появятся.',
    '',
    'Слежу за:',
    ...subs.map((s) => `• ${searchLabel(s)}`),
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

// The site is read through a paid anti-bot service, and the bot as a whole has a daily budget.
export const PROTECTED_LIMIT_TEXT =
  'Этот сайт защищён от ботов и читается через платный сервис — на весь бот его лимит занят; ' +
  'место освободится, когда другие такие подписки удалят или бот поставит их на паузу.';
