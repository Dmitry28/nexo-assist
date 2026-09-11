/**
 * Preview a listing card — and, on demand, send it through the bot.
 *
 * The card has four shapes that take different Telegram calls, and only a real client shows
 * whether an album's caption fits or a challenge character breaks the markup. Doing that with a
 * throwaway script each time is how a formatting regression ships unnoticed, so it lives here.
 *
 *   npm run notify:test            print the cards to stdout (no credentials needed)
 *   npm run notify:test -- --send  send them to ADMIN_TELEGRAM_ID via TELEGRAM_BOT_TOKEN
 *
 * Mock data on purpose: no scraping and fixed timestamps, so the output is the same every run
 * and the diff after a formatting change is readable. Keep the shapes below covering every
 * branch the card takes.
 */
import 'dotenv/config';

import { autoRetry } from '@grammyjs/auto-retry';
import { Logger } from '@nestjs/common';
import { Bot } from 'grammy';

import { wait } from '@/common/wait';
import type { Listing } from '@/modules/sources/source-adapter';
import type { CardSender } from '@/modules/telegram/bot/send-card';
import {
  SEND_DELAY_MS,
  apiCardSender,
  listingMessage,
  sendCard,
} from '@/modules/telegram/bot/send-card';
import { tailBatches } from '@/modules/telegram/bot/telegram.format';

// Wikimedia placeholders: real images at realistic sizes, and no dependency on a source being up.
const PHOTOS = [
  { dir: 'a/a7', file: 'Camponotus_flavomarginatus_ant.jpg' },
  { dir: '3/3f', file: 'Bikewest_shark_bay.jpg' },
] as const;

const PHOTO = (n: number): string => {
  const { dir, file } = PHOTOS[n % PHOTOS.length];
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${dir}/${file}/640px-${file}`;
};

/** Fixed so two runs differ only where the formatting did — and so «вчера» is reachable. */
const at = (hoursAgo: number): string =>
  new Date(Date.UTC(2026, 8, 11, 9, 0) - hoursAgo * 60 * 60 * 1000).toISOString();

const base = (id: number): Listing => ({
  externalId: String(id),
  link: `https://re.kufar.by/vi/${id}`,
  title: `Тестовое объявление №${id}`,
  listTime: at(2),
  images: [],
  details: [],
});

const MOCK_LISTINGS: Listing[] = [
  // An album with a map pin — the media-group path, and the caption limit that comes with it.
  {
    ...base(1),
    title: 'Дом с участком, г. Гродно, ул. Калиновского',
    description: 'Кирпичный дом 2024 года, центральное отопление, участок с садом.',
    address: 'Гродно, Калиновского ул. 14',
    priceByn: 558_645,
    priceUsd: 185_000,
    seller: 'Агентство недвижимости',
    images: [PHOTO(0), PHOTO(1), PHOTO(0), PHOTO(1)],
    coordinates: { lat: 53.6822, lon: 23.8558 },
    details: [
      { label: 'Тип', value: 'Дом' },
      { label: 'Площадь', value: '186.9 м²' },
      { label: 'Участок', value: '13.11 сот.' },
      { label: 'Комнат', value: '4' },
      { label: 'Год постройки', value: '2024' },
      { label: 'Отопление', value: 'Центральное' },
    ],
  },
  // One photo — the sendPhoto path.
  {
    ...base(2),
    title: 'Участок 9.84 сот., Кировск',
    priceUsd: 7000,
    images: [PHOTO(1)],
    details: [{ label: 'Участок', value: '9.84 сот.' }],
  },
  // Nothing but the essentials — the plain-message path, the "negotiable price" line, and a
  // bump old enough to read as a date rather than «сегодня».
  { ...base(3), title: 'Гараж без фото и без цены', listTime: at(24 * 40) },
  // The characters that would break an HTML-parsed message, plus a description long enough to be
  // trimmed against the caption limit.
  {
    ...base(4),
    title: 'Дом <b>дёшево</b> & "быстро" — 5 < 10',
    description: `Описание, которое не влезает в подпись к фото. ${'Очень длинный текст. '.repeat(60)}`,
    address: 'ул. "Тихая" <центр>',
    priceByn: 100_000,
    images: [PHOTO(0), PHOTO(1)],
    details: [{ label: 'Тип', value: '<Дача>' }],
  },
  // More photos than Telegram accepts in one album — the eleventh must be dropped, not rejected.
  {
    ...base(5),
    title: 'Одиннадцать фото — альбом обрезается до десяти',
    priceUsd: 42_000,
    listTime: at(26),
    images: Array.from({ length: 11 }, (_, i) => PHOTO(i)),
  },
  // A dead image URL: under --send this is the photo→text fallback, which no test can show.
  {
    ...base(6),
    title: 'Битая ссылка на фото — карточка должна уйти текстом',
    priceByn: 55_000,
    images: ['https://upload.wikimedia.org/wikipedia/commons/does-not-exist.jpg'],
  },
];

function printer(): CardSender {
  const show = (what: string, text?: string): Promise<void> => {
    console.info(`\n─── ${what}${text === undefined ? '' : `\n${text}`}`);
    return Promise.resolve();
  };
  return {
    photo: (url, caption) => show(`sendPhoto ${url}`, caption),
    group: (media) => show(`sendMediaGroup ×${media.length}`, media[0].caption),
    html: (text) => show('sendMessage', text),
    location: ({ lat, lon }) => show(`sendLocation ${lat},${lon}`),
  };
}

function telegram(): { sender: CardSender; text: (text: string) => Promise<unknown> } {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = Number(process.env.ADMIN_TELEGRAM_ID);
  if (token === undefined || token === '' || !Number.isFinite(chatId)) {
    throw new Error('--send needs TELEGRAM_BOT_TOKEN and ADMIN_TELEGRAM_ID (use the dev bot)');
  }
  const { api } = new Bot(token);
  // Like the running bot: without it a 429 mid-preview crashes the very tool meant to show the
  // messages (telegram.service.ts installs the same plugin).
  api.config.use(autoRetry());
  // The production sender, not a copy of it — a copy would drift and quietly stop testing
  // what actually ships.
  return { sender: apiCardSender(api, chatId), text: (text) => api.sendMessage(chatId, text) };
}

async function main(): Promise<void> {
  const send = process.argv.includes('--send');
  const printing = printer();
  const live = send ? telegram() : undefined;
  const sender = live?.sender ?? printing;
  const logger = new Logger('notify-test');

  for (const [i, listing] of MOCK_LISTINGS.entries()) {
    // The first card goes out unnumbered: one fresh listing is the ordinary case, and "1/1"
    // would be noise the reader never actually sees.
    const position = i === 0 ? undefined : { index: i + 1, total: MOCK_LISTINGS.length };
    const message = listingMessage(listing, position);
    console.info(
      `[${i + 1}/${MOCK_LISTINGS.length}] photos ${message.images.length}, ` +
        `pin ${message.coordinates ? 'yes' : 'no'}, caption ${message.caption.length} chars`,
    );
    // Paced like a real delivery — an album counts as several messages to the same chat.
    if (i > 0 && send) await wait(SEND_DELAY_MS);
    await sendCard(sender, message, logger);
  }

  // The other shape a user receives: everything past CARDS_PER_DELIVERY arrives as this digest,
  // as plain text (it is deliberately unescaped — see telegram.format.ts).
  for (const batch of tailBatches(MOCK_LISTINGS)) {
    console.info(`[tail] digest of ${batch.listings.length}, ${batch.text.length} chars`);
    if (send) await wait(SEND_DELAY_MS);
    await (live === undefined ? printing.html(batch.text) : live.text(batch.text));
  }

  console.info(send ? '\nSent.' : '\nPrinted. Add --send to deliver through the bot.');
}

void main().catch((err: unknown) => {
  console.error('notify:test failed:', err);
  process.exit(1);
});
