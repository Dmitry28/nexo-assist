/**
 * Run the real bot end to end with Telegram swapped for a fake Bot API on localhost — chat with
 * it from the command line and run the daily watch on demand, nothing sent to Telegram.
 *
 *   npm run sim:bot -- /start https://re.kufar.by/l/minsk tap:Следить /list tap:#1 run
 *
 * Steps, in order:
 *   <text>          the user sends it — a command, a link, any text
 *   tap:<label>     the user taps the button of the latest bot message whose label contains it
 *   reply:<text>    the user replies to the latest bot message (a ForceReply prompt: the filter)
 *   run             the daily watch run (WatchScheduler.runDaily) — every active subscription
 *
 * Everything else is the dev app as `npm run start:dev` runs it: `.env`, the local database, the
 * live sites, and the paid keys if `.env` has them (they spend the same free tiers as production).
 * Only the bot token and TELEGRAM_API_ROOT are replaced. The user is ADMIN_TELEGRAM_ID when set
 * (so /check and /stats answer), else SIM_USER_ID, default 1. Every bot call is printed; a
 * message to another chat (another user's delivery) is printed with its chat id — an owner alert
 * lands in the sim user's own chat when that is the admin.
 *
 * A step is done when the bot polls for the next update — grammY awaits each handler first, so
 * this holds for everything a handler awaits (the subscribe-time baseline included). The bot's
 * texts are printed as sent: an owner alert quoting an error shows it whole.
 *
 * Why a fake Bot API rather than handler mocks: the bot runs unchanged — grammY's long polling,
 * the command menu, the update queue — the way grammY's own docs suggest testing a bot offline.
 */
import 'dotenv/config';

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { NestFactory } from '@nestjs/core';

// Bodies the bot sends and the parts of Telegram's answers it reads.
type Params = Record<string, unknown>;
interface Button {
  text: string;
  callback_data?: string;
  url?: string;
}
interface SentMessage {
  message_id: number;
  chat: { id: number; type: 'private' };
  date: number;
  text?: string;
  caption?: string;
  reply_markup?: { inline_keyboard?: Button[][]; force_reply?: boolean };
}

const BOT = { id: 1, is_bot: true, first_name: 'Sim', username: 'sim_nexo_bot' };
// A baseline walks a whole search: give a step this long before calling it stuck.
const STEP_TIMEOUT_MS = 5 * 60_000;

const userId = Number(process.env.ADMIN_TELEGRAM_ID || process.env.SIM_USER_ID || 1);
const user = { id: userId, is_bot: false, first_name: 'Sim', username: 'sim_user' };
const chat = { id: userId, type: 'private' as const };

let nextUpdateId = 1;
let nextMessageId = 1000;
const now = (): number => Math.floor(Date.now() / 1000);
const queue: Params[] = [];
const sent: SentMessage[] = [];
// The handler of the latest update is done when the bot polls again (grammY handles a batch,
// then asks for the next) — resolved by the next getUpdates.
let polled: (() => void) | undefined;
let waitingPoll: ((updates: Params[]) => void) | undefined;

/** A parameter of a JSON or multipart body (a photo upload is multipart). */
async function readParams(req: IncomingMessage): Promise<Params> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString('utf8');
  const type = req.headers['content-type'] ?? '';
  if (type.includes('application/json')) return JSON.parse(body || '{}') as Params;
  if (!type.includes('multipart/form-data')) return {};
  const params: Params = {};
  for (const [, name, value] of body.matchAll(/name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g)) {
    const text = value ?? '';
    params[name ?? ''] = /^[[{]/.test(text) ? (JSON.parse(text) as unknown) : text;
  }
  return params;
}

function record(method: string, params: Params): SentMessage {
  const message: SentMessage = {
    message_id: nextMessageId++,
    chat: { id: Number(params.chat_id ?? userId), type: 'private' },
    date: now(),
    text: params.text as string | undefined,
    caption: params.caption as string | undefined,
    reply_markup: params.reply_markup as SentMessage['reply_markup'],
  };
  sent.push(message);
  print(method, message);
  return message;
}

function print(method: string, message: SentMessage): void {
  const to = message.chat.id === userId ? '' : ` → chat ${message.chat.id}`;
  const body = (message.text ?? message.caption ?? '').trim();
  console.info(`  ← ${method}${to}: ${body.replace(/\n/g, '\n      ')}`);
  for (const row of message.reply_markup?.inline_keyboard ?? []) {
    console.info(`      [${row.map((button) => button.text).join('] [')}]`);
  }
  if (message.reply_markup?.force_reply) console.info('      (asks for a reply)');
}

/** The fake Bot API: answers like Telegram and records what the bot sends. */
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = (req.url ?? '').split('/').pop() ?? '';
  const params = await readParams(req);
  const reply = (result: unknown): void => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result }));
  };
  switch (method) {
    case 'getMe':
      return reply(BOT);
    case 'getUpdates': {
      // Cleared before the call: the first stage of a delivery installs the second.
      const onPoll = polled;
      polled = undefined;
      onPoll?.();
      if (queue.length > 0) return reply(queue.splice(0));
      // Long poll, as Telegram does: answer when a step queues an update, or empty after a while.
      const timer = setTimeout(
        () => {
          waitingPoll = undefined;
          reply([]);
        },
        1000 * Math.min(Number(params.timeout ?? 1), 5),
      );
      waitingPoll = (updates) => {
        clearTimeout(timer);
        reply(updates);
      };
      return;
    }
    case 'sendMediaGroup': {
      const media = (params.media as Params[] | undefined) ?? [];
      return reply(
        media.map((item, i) =>
          record(i === 0 ? method : `${method}[${i}]`, { ...params, ...item }),
        ),
      );
    }
    default:
      if (/^(send|edit)/.test(method)) return reply(record(method, params));
      // answerCallbackQuery, setMyCommands, deleteWebhook… — recorded only when they say something.
      if (typeof params.text === 'string') console.info(`  ← ${method}: ${params.text}`);
      return reply(true);
  }
}

/** Queue an update and wait until the bot has handled it. */
function deliver(update: Params): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      polled = undefined;
      reject(new Error('step timed out'));
    }, STEP_TIMEOUT_MS);
    polled = () => {
      // The poll that takes this update fires first; the one after it means it was handled.
      polled = () => {
        clearTimeout(timer);
        resolve();
      };
    };
  });
  const full = { update_id: nextUpdateId++, ...update };
  if (waitingPoll) {
    // The bot is already waiting: this answer is the poll that takes the update.
    const answer = waitingPoll;
    waitingPoll = undefined;
    const onPoll = polled;
    polled = undefined;
    onPoll?.();
    answer([full]);
  } else {
    queue.push(full);
  }
  return done;
}

const userMessage = (text: string, extra: Params = {}): Params => ({
  message: {
    message_id: nextMessageId++,
    date: now(),
    chat,
    from: user,
    text,
    ...(text.startsWith('/')
      ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(/\s/)[0]?.length }] }
      : {}),
    ...extra,
  },
});

const latest = (match: (message: SentMessage) => boolean): SentMessage | undefined =>
  [...sent].reverse().find((message) => message.chat.id === userId && match(message));

function tap(label: string): Params {
  const message = latest((m) =>
    (m.reply_markup?.inline_keyboard ?? []).some((row) =>
      row.some((button) => button.text.includes(label)),
    ),
  );
  const button = message?.reply_markup?.inline_keyboard
    ?.flat()
    .find((candidate) => candidate.text.includes(label));
  if (!message || !button?.callback_data) throw new Error(`no button «${label}» to tap`);
  return {
    callback_query: {
      id: String(nextUpdateId),
      from: user,
      chat_instance: 'sim',
      data: button.callback_data,
      message: { ...message, from: BOT },
    },
  };
}

function replyTo(text: string): Params {
  const prompt = latest((m) => m.reply_markup?.force_reply === true) ?? latest(() => true);
  if (!prompt) throw new Error('nothing to reply to');
  return userMessage(text, { reply_to_message: { ...prompt, from: BOT } });
}

void (async () => {
  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error(`fake Bot API: ${(err as Error).message}`);
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, description: (err as Error).message }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  // Set before the app loads: ConfigModule never overwrites a key already in the environment.
  const root = `http://127.0.0.1:${port}`;
  if (process.env.APP_ENV === 'production') throw new Error('the sim never runs as production');
  // The local database only: a sim run subscribes, baselines and marks things seen.
  const db = process.env.DATABASE_URL ?? '';
  if (db && !/@(localhost|127\.0\.0\.1)[:/]/.test(db)) {
    throw new Error(
      'DATABASE_URL is not local — the sim writes to it; point it at the dev database',
    );
  }
  process.env.TELEGRAM_BOT_TOKEN = 'sim';
  process.env.TELEGRAM_API_ROOT = root;
  // The watchdog pings land here, not at the real watchdog: a sim is no proof the app is alive.
  process.env.HEARTBEAT_URL = `${root}/heartbeat`;
  process.env.LOG_LEVEL = process.env.SIM_LOG_LEVEL ?? 'warn';
  // Loaded after the environment is set: the config reads it on import.
  const { AppModule } = await import('@/app.module');
  const { WatchScheduler } = await import('@/modules/telegram/watch/watch.scheduler');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  let failed = false;
  try {
    for (const step of process.argv.slice(2)) {
      console.info(`→ ${step}`);
      if (step === 'run') {
        const before = sent.length;
        await app.get(WatchScheduler).runDaily();
        console.info(`  (run finished — ${sent.length - before} message(s))`);
      } else if (step.startsWith('tap:')) await deliver(tap(step.slice(4)));
      else if (step.startsWith('reply:')) await deliver(replyTo(step.slice(6)));
      else await deliver(userMessage(step));
    }
  } catch (err) {
    failed = true;
    console.error(`✗ ${(err as Error).message}`);
  } finally {
    await app.close();
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
