# Product — how it works

> Living doc: the target design (behavior + architecture); **Status now** marks
> what is already implemented. Keep it current on any change. Roadmap lives in
> [PRODUCT_PLAN.md](PRODUCT_PLAN.md).

## What it is

A Telegram bot. A user pastes a filtered search link (kufar/realt and more) and
the bot sends new / changed / removed listings for it on a schedule (daily to
start; more frequent once throttling/dedupe land).

## Status now (implemented)

- Sources: **kufar + realt** via the adapter registry; paginated fetch (page cap).
- Events: **new only**; a text digest split across as many messages as it takes (up to 100
  listings per delivery, one message a second), no photos yet. Anything beyond that ceiling is
  announced, not dropped, and arrives over the following runs — bounded by the page window, so a
  backlog past roughly 150 listings does fall out of it (PRODUCT_PLAN.md, findings of 2026-09-07).
  An over-long title is truncated first, so price and link survive; only a pathological link
  (~490+ chars) forces the whole line to be clamped, link included.
- Bot language: **Russian** — the beta audience is the kufar.by/realt.by one. Per-profile
  language comes later (PRODUCT_PLAN.md, phase 7 "i18n"). Logs and code stay English.
- Buttons: Следить / Отмена / Показать текущие / list / remove / resume. `/list` is capped to fit
  one Telegram message and marks paused subscriptions (⏸), each with a ▶️ button that un-pauses
  it, respecting the active-subscription limit. ▶️ and re-sending the URL are **not** the same:
  ▶️ clears the pause and the failure streak and leaves the seen set alone — what appeared during
  the pause was never delivered, so it was never marked seen and it starts arriving on the next
  run, under the same ceiling and page window as any other backlog (so a long pause loses its
  oldest listings);
  re-sending the URL revives the subscription and then re-baselines it, which marks that backlog
  seen and drops it. The two paths should share one semantic — PRODUCT_PLAN.md,
  «Технический бэклог», findings of 2026-09-07.
  The «Показать текущие» button fetches live, so it stays off the sources while a run is in
  progress — but it only peeks at the polling slot, never holds it: any user can tap it, and
  holding the slot would let one tap cancel the day's run for everyone. The residual race is
  documented and accepted: a tap that lands just before a run starts still polls concurrently.
- Owner-only commands (`ADMIN_TELEGRAM_ID`), silent for everyone else so they stay unadvertised:
  `/stats` reports users / active / paused / last successful run; `/check` polls now instead of waiting
  for the cron — open to anyone outside production, owner-only inside it. `/check` is paced like
  the daily run, covers the first 5 active subscriptions (grammY handles updates one at a time,
  so a longer loop would freeze the bot for everyone), and shares one polling slot with the
  daily run: `/check` is refused when the run holds it, and the run is **skipped for the day**
  when `/check` holds it (the owner is told) — so they never poll the same subscriptions at
  once or race each other's "seen" bookkeeping.
- Adapters pin newest-first sorting and start from page 1 regardless of pasted params.
- Baseline on subscribe; seen marked **only after successful delivery**.
- Failures are loud: a fetch **or parse** failure (outage, bot-wall, layout change)
  raises an error — it is never mistaken for an empty search. Scraper redirects are
  pinned to the source's host.
- Storage: **Postgres (TypeORM, generated migrations)** — users, subscriptions and the
  seen set survive restarts; seen is pruned to a bounded window per subscription;
  per-user limit on **active** subscriptions (auto-paused ones don't count) + duplicate-URL guard.
- Deployment: **single replica** (long-polling bot + in-memory pending prompts and polling slot —
  a second replica would double-deliver, see k8s NOTE);
  production refuses to boot without `TELEGRAM_BOT_TOKEN`; a dead polling loop exits
  the process so the orchestrator restarts it.
- Unsupported link → plain "this site is not supported yet" message (Issue flow is Phase 6).

Everything below this section describes the target design.

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

- **First subscription:** take a baseline of recent listings, send nothing.
- **Many new at once:** the digest goes out as several messages (overall cap 100 listings per
  delivery), not one message per item and not a silent "N more" drop. Messages are paced one per
  second, and only what actually reached the user is marked seen — a failure mid-way re-sends the
  rest, never the part that arrived.
- **Telegram limits:** messages to one chat are paced one per second, and subscriptions are
  polled with a gap — enough at beta volume. A global fan-out queue (Telegram's ~30 msg/s ceiling)
  is not built and is not needed until the user count makes it reachable. If a user blocked the
  bot (403) → pause their subscriptions.
- **Dead link:** if a search keeps failing to poll (errors, not empty results) for
  several runs in a row → tell the user to refresh it and pause that subscription.
  A paused subscription is revived by re-sending its link or by ▶️ in `/list`.
- **Dead-man's switch:** the app pings an external watchdog every 5 minutes (`HEARTBEAT_URL`);
  when the pings stop, the watchdog alerts the owner. It covers what no in-app report can — the
  app dying outright.
- **Admin alerts:** the owner (`ADMIN_TELEGRAM_ID`, required in production — without it every
  alert below would go nowhere silently) is notified on every auto-pause
  (403 / dead link) and when a whole source fails all its polls in a run — the latter only once
  that source was polled at least three times, so a source with fewer subscriptions than that
  is auto-paused without an outage alert (PRODUCT_PLAN.md § Технический бэклог).
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

Deferred until needed (kept out of the contract for now): `normalizeUrl` (URL
dedupe — Phase 3), `capabilities: EventKind[]` (with removed/price events).
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
