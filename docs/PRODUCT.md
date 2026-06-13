# Product — how it works

> Living doc: how the product is built (behavior + architecture). Keep it current
> on any change. Roadmap lives in [PRODUCT_PLAN.md](PRODUCT_PLAN.md).

## What it is

A Telegram bot. A user pastes a filtered search link (kufar/realt and more) and
the bot sends new / changed / removed listings for it once a day.

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

1. The scheduler runs the scrape once a day.
2. Collect the unique normalized URLs of active subscriptions (dedupe).
3. For each URL the adapter fetches listings **incrementally** (newest-first,
   stop at already-seen, page cap) and normalizes them.
4. Diff against the source's previous snapshot → delta (new / removed / price).
5. Per subscription, build the delivery using its baseline and what was already delivered.
6. Persist only what was actually delivered (on failure, retry next run — no loss, no duplicates).

**Two "seen" levels:** the delta is per source (normalized URL, dedupe); delivery
is per subscription (a new subscriber gets a baseline, not a flood).

## Volume and limits

- **First subscription:** take a baseline of recent listings, send nothing.
- **Many new at once:** send a digest — cap the item count + an "N more on the
  site" link, not one message per item.
- **Telegram limits:** throttle the fan-out through a queue; if a user blocked the
  bot (403) → pause their subscriptions.
- **Source with no subscribers:** stop scraping it and purge its data.

## Architecture

**Source adapter** — the only place that knows about a specific site:

```ts
interface SourceAdapter {
  id: string; // 'kufar', 'realt', ...
  matches(url: string): boolean; // recognize the link
  normalizeUrl(url: string): string; // canonical key for dedupe
  capabilities: EventKind[]; // ['new','removed','price']
  fetch(url: string): Promise<RawListing[]>;
  parse(raw: RawListing): NormalizedListing; // shared fields + extras (JSONB)
  format(listing: NormalizedListing, e: EventKind): TelegramMessage;
}
```

`SourceRegistry` picks the adapter via `matches()`. The core (fetch → diff →
notify), the bot, and the DB schema know nothing about specific sites. `parse`
must return a stable `externalId` — the diff and dedupe key off it.

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
