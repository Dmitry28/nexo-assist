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
- Events: **new only**; text digest (cap 10 + "…and N more"), no photos yet.
- Buttons: Subscribe / Cancel / Show current / list / remove; non-production `/check`
  (manual test trigger — dev and staging). `/list` is capped to fit one Telegram message.
- Adapters pin newest-first sorting and start from page 1 regardless of pasted params.
- Baseline on subscribe; seen marked **only after successful delivery**.
- Failures are loud: a fetch **or parse** failure (outage, bot-wall, layout change)
  raises an error — it is never mistaken for an empty search. Scraper redirects are
  pinned to the source's host.
- Storage: **in-memory** (lost on restart) — DB lands in Phase 3.
- Deployment: **single replica** (long-polling bot + in-memory state; see k8s NOTE);
  production refuses to boot without `TELEGRAM_BOT_TOKEN`; a dead polling loop exits
  the process so the orchestrator restarts it.
- Unsupported link → plain "not supported yet" message (Issue flow is Phase 6).

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
6. Persist only what was actually delivered (on failure, retry next run — no loss, no duplicates).

**Two "seen" levels:** the delta is per source (normalized URL, dedupe); delivery
is per subscription (a new subscriber gets a baseline, not a flood).

## Volume and limits

- **First subscription:** take a baseline of recent listings, send nothing.
- **Many new at once:** send the digest in batches of messages (overall cap
  ~100), not one message per item and not a silent "N more" drop.
- **Telegram limits:** throttle the fan-out through a queue; if a user blocked the
  bot (403) → pause their subscriptions.
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
