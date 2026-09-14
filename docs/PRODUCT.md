# Product — how it works

> Living doc: the target design (behavior + architecture); **Status now** marks
> what is already implemented. Keep it current on any change. Roadmap lives in
> [PRODUCT_PLAN.md](PRODUCT_PLAN.md).

## What it is

A Telegram bot. A user pastes a filtered search link (kufar/realt and more) and
the bot sends new / changed / removed listings for it on a schedule (daily to
start; more frequent once throttling/dedupe land).

## Status now (implemented)

- Sources: **kufar + realt** via the adapter registry; each search is fetched newest-first,
  up to 5 pages (~150 listings) — a pasted sort or page number is overridden.
- Events: **new only**, delivered as **one card per listing**: photos (up to 10, as an album),
  title, description, price in both currencies, address, the source's own facts (area, plot,
  rooms, year, amenities…), seller, when it was bumped, and the link — plus a map pin when the
  source publishes one (kufar does, realt does not). Past **30 cards** in one delivery the rest
  goes out as a compact text digest in the same run, so nothing is deferred and nothing is lost.
  Messages are paced one per second. A refused photo falls back to the text card; a refused pin
  is ignored — the listing already arrived.
- Bot language: **Russian** — the beta audience is the kufar.by/realt.by one. Logs and code stay
  English; per-profile language is Phase 7.
- Buttons: Следить / Отмена / Показать текущие, and in `/list` ❌ remove / ▶️ resume. A «Следить»
  prompt stays tappable for 24 hours and only until the next restart; after that the button
  answers «Кнопка устарела» and the link is pasted again. `/list` shows as much as fits one
  message, announces the rest, and marks paused subscriptions with ⏸.
- ▶️ and re-sending the URL are **not** the same: ▶️ only lifts the pause, so everything that
  appeared during it still arrives; re-sending re-baselines the subscription and drops that
  backlog. The two need one semantic — PRODUCT_PLAN.md, «Технический бэклог».
- «Показать текущие» fetches live, so it stays off the sources while a run is in progress. It
  answers with one compact digest, not cards: it is a look at what is already there, on demand.
- Owner-only commands (`ADMIN_TELEGRAM_ID`), silent for everyone else so they stay unadvertised:
  `/stats` reports users / active / paused / last successful run; `/check` polls now instead of
  waiting for the cron (its first 5 active subscriptions; outside production anyone may use it).
  `/check` and the daily run share one polling slot, so they never poll at once: `/check` is
  refused while a run holds it, and the day's run is **skipped** when `/check` does (owner told).
- Baseline on subscribe; seen marked **only after successful delivery**.
- Failures are loud: a fetch **or parse** failure (outage, bot-wall, layout change) raises an
  error — never mistaken for an empty search. Redirects are pinned to the source's host.
- Storage: **Postgres (TypeORM, generated migrations)** — users, subscriptions and the seen set
  survive restarts; seen is pruned to a bounded window per subscription; per-user limit on
  **active** subscriptions (auto-paused ones don't count) + duplicate-URL guard.
- Deployment: **single replica** (why — PRODUCT_TECH.md, «Известные ограничения»); production
  refuses to boot without `TELEGRAM_BOT_TOKEN`; a dead polling loop exits the process so the
  orchestrator restarts it.
- Unsupported link → plain "this site is not supported yet" message (Issue flow is Phase 6).

Below this line, «User flow», «How it works inside» and «Architecture» describe the **target**
design; «Volume and limits» describes what is **already shipped** (limits, pausing, alerts).

## User flow

1. `/start` → greeting and buttons.
2. Paste a search link (the only text input).
3. The bot recognizes the source:
   - **Supported** → preview + buttons "Subscribe / Name / Events / Cancel".
   - **Not supported** → asks what to track → opens a GitHub Issue → "we'll add it, you'll be notified".
4. Everything else is buttons: list, pause, remove, configure.
5. Once a day, per subscription — only changes: new items (card: photo, title,
   price, link), optionally removed items and price changes.

## How it works inside

1. The scheduler runs the scrape on its cron (daily to start).
2. Collect the unique normalized URLs of active subscriptions (dedupe).
3. For each URL the adapter fetches listings **page by page** (newest-first, capped
   at a few pages) and normalizes them. (Early stop-on-already-seen is a later
   optimization — for now dedup happens in step 5 via the seen set.)
4. Diff against the source's previous snapshot → delta (new / removed / price).
5. Per subscription, build the delivery using its baseline and what was already delivered.
6. Persist only what was actually delivered (on failure, retry next run). The guarantee is
   **no loss**, not exactly-once: if recording the seen set fails after a successful send, or the
   pod dies between the two, those listings are re-sent next run. Duplicates are the deliberate
   choice over silence (see `src/modules/telegram/bot/telegram.deliver.ts`).

**Two "seen" levels:** the delta is per source (normalized URL, dedupe); delivery
is per subscription (a new subscriber gets a baseline, not a flood).

## Volume and limits

- **Telegram limits:** messages to one chat are paced one per second and subscriptions are polled
  with a gap — enough at beta volume. A global fan-out queue (Telegram's ~30 msg/s ceiling) is not
  built and isn't needed until the user count makes it reachable. A user who blocked the bot (403)
  gets their subscriptions paused.
- **Dead link:** a search that keeps failing to poll (errors, not empty results) for five runs in
  a row is paused, and the user is asked to check the link. **Unless the whole source failed that
  run** — a broken adapter fails every poll, so «Проверьте ссылку» would be false for everyone;
  then nothing is paused, the owner gets the outage alert, and the streak keeps counting until the
  source answers for somebody (or hits the 15-failure ceiling, since a source whose every
  subscription is dead can never answer again).
- **Dead-man's switch:** the app pings an external watchdog every 5 minutes (`HEARTBEAT_URL`);
  when the pings stop, the watchdog alerts the owner (setup — DEPLOY.md §4.3b).
- **Admin alerts:** the owner (`ADMIN_TELEGRAM_ID`, required in production — otherwise every alert
  would go nowhere silently) is told about each auto-pause (403 / dead link) and about a source
  that failed all its polls in a run. That verdict needs at least three polls, so a source with
  fewer subscriptions is neither reported nor given the reprieve above
  (PRODUCT_PLAN.md § Технический бэклог).
- **Source with no subscribers:** stop scraping it and purge its data.

## Architecture

**Source adapter** — the only place that knows about a specific site:

```ts
interface SourceAdapter {
  readonly id: SourceId; // 'kufar' | 'realt'
  matches(url: string): boolean; // recognize the link (host check)
  fetch(url: string): Promise<Listing[]>; // fetch + parse → normalized listings
}
```

`SourceRegistry` picks the adapter via `matches()` (or by id). The core (fetch →
diff → notify), the bot, and the DB schema know nothing about specific sites.
`fetch` returns `Listing`s with a stable `externalId` — the diff/dedup key.

Deferred until needed (kept out of the contract for now): `capabilities: EventKind[]`
(with removed/price events). URL dedupe shipped instead as `normalizeUrl` in `common/url.ts`,
source-agnostic and backed by a unique index — not as part of the adapter contract.
Parsing is an adapter-internal detail; message formatting lives in the telegram
layer, not the adapter.

**Data (Postgres):** shared fields are columns, source-specific data is JSONB.

- `users`, `sources` (normalized URL, adapter_id, schedule),
  `subscriptions` (user↔source, name, event types, status).
- `listings` — shared columns + `extras` JSONB.
- `source_snapshots` — source snapshot for the delta (seen level 1).
- `deliveries` — what was delivered per subscription + baseline (seen level 2).

## Extending

A new source = a new adapter implementing the contract; the core, the bot, and
the DB schema stay unchanged. An unsupported link → GitHub Issue → the adapter is
added (including with LLM help).
