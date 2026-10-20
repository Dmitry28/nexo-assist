# Product — how it works

> Living doc: the target design (behavior + architecture); **Status now** marks
> what is already implemented. Keep it current on any change. Roadmap lives in
> [PRODUCT_PLAN.md](PRODUCT_PLAN.md).

## What it is

A Telegram bot. A user pastes a filtered search link (kufar/realt and more) and
the bot sends new / changed / removed listings for it on a schedule (daily to
start; more frequent once throttling/dedupe land).

## Status now (implemented)

- Sources: **kufar (sale and long-term rent), kufar travel (per-night rent), realt, vacancies from
  gsz.gov.by (state vacancy bank) and rabota.by, and fixed pages — ghb.by's price list,
  grodnorik.gov.by's auction notices, prometr.by new-build complexes, gridom.by developers'
  units and gcn.by state auctions (no paging there), and cars and parts behind anti-bot protection —
  used parts from idriver.by and bamper.by, used cars from cars.av.by (a brand or model page — its
  `/filter` links ignore their filters). US auction lots from bid.cars (the pasted search:
  the free page when it opens, otherwise Copart and IAAI with the same filters (one house not answering, the other's lots still go out) — odometer,
  engine size and start code (which the auctions' search does not take) are applied to the lots
  fetched, shown on the card; any other filter they cannot honour, and `status=All`, are refused; fallback cards link to
  the auction page), and the auctions themselves — copart.com (up
  to the 500-listing window; the link’s `searchCriteria`, or else `query` / make / model) and
  iaai.com (up to the 500-listing window; the link’s `Keyword`; through our proxy)** — via the adapter
  registry. copart.com refuses every IP we have (Imperva), so its search goes up the fetch
  ladder as a POST and is read through a paid service (ScrapingAnt / ScraperAPI) when the free
  rungs fail — so a Copart search (5 credits a poll) and a bid.cars one (6, its Copart walk) count
  against the same daily paid-credit budget as the protected sites: about 50 such searches
  bot-wide, past which a new one is refused. A paged search is fetched newest-first, and a run looks at its **newest 500 listings**
  (up to 20 pages, paced) — a pasted sort or page number is overridden; a search that gains more than that
  between two runs loses the rest (the owner is told via Sentry). A protected site is read as its
  first page only (a page with nothing seen before tells the owner the same way; each page may be paid; a run fetches a search once, however many users watch
  it, and a new search past its site group's daily paid-credit budget is refused — one already watched
  never is): av.by's 25 «актуальные».
- Events: **new listings, price changes and removals**. New ones arrive as **one card per listing**: photos (up to 10, as an album),
  title, description, price in both currencies (or as the site words it — a salary range), address, the source's own facts (area, plot,
  rooms, year, amenities…), seller, when it was bumped, the link, and **which of the reader's
  searches it came from** (source plus the search URL's path — a reader may be watching dozens) — plus a map pin when the
  source publishes one (the real-estate sources do). Past **30 cards** in one delivery the rest
  goes out as a compact text digest in the same run, so nothing is deferred and nothing is lost.
  Messages are paced one per second. A lone photo Telegram cannot fetch is downloaded by the bot
  and uploaded as a file — that is how idriver's photos arrive. Media that still fails falls
  back to the text card; a refused pin is ignored — the listing already arrived.
- **Price changes** on listings already delivered come after the cards as a text digest
  «💸 Цена изменилась: N» — title, `old → new`, link. Only a seller's change: exchange-rate drift
  and text prices (salaries, ghb's per-m² range) are not reported, and the first poll after
  subscribing only records prices (rule: [PRODUCT_PLAN.md § 2.4](PRODUCT_PLAN.md)).
- **Removals** — «🚫 Снято с продажи: N» (title, last price, link), last in the delivery — only
  on fixed sale lists (ghb, prometr, gridom), and only when the page was read whole. Elsewhere a
  listing leaving the page is no sale (a search window, an auction archive). One that comes back
  arrives as new.
- **Одно объявление** — a link to a single ad (kufar `re.kufar.by/vi/…`, kufar per-night `travel.kufar.by/vi/…` (not a hotel — refused, its price depends on the dates), realt `…/object/<code>/`, a rabota.by vacancy `/vacancy/<id>` — its salary's lower bound in BYN or USD is the price) watches that
  ad: «Слежу за объявлением «…» — сейчас <price>», then «💸» on a price change (its price is
  stored at subscribe) and «🚫 Объявление снято — больше не слежу» when the site itself says the
  ad no longer exists (kufar's 404 «Ad is not found», realt's own 404 page, a rabota vacancy marked archived or hh's 404) — the watch is then paused (▶️ resumes it;
  if the ad is still gone, it is paused again). An outage or
  any other broken page is a failure, never «removed». An ad already gone is refused on
  subscribe. Two forms of the same ad link are one duplicate (stored as `re.kufar.by/vi/<id>`,
  `realt.by/<category>/object/<code>/`).
- A realt link the site **rewrites with a redirect** (any `addressV2` address filter is sent to a
  much wider search) is refused on subscribe, with the reason and how to fix the link —
  following it would hand the user someone else's search as theirs.
- **A week of silence is confirmed:** a user who received nothing for 7 days gets one
  message — «🔕 Новых объявлений пока нет…» and the list of their searches (one per user, not
  per search). Only searches that polled fine that run are listed — a source that did not answer is
  never reported as «nothing new».
- Bot language: **Russian** — the beta audience is the kufar.by/realt.by one. Logs and code stay
  English; per-profile language is Phase 7.
- Buttons: Следить / Отмена / Показать текущие. A «Следить» prompt stays tappable for 24 hours
  and only until the next restart; after that the button answers «Кнопка устарела» and the link is
  pasted again. `/list` lists every subscription in one message — a short linked label each
  («kufar.by · grodno/kupit/dom», ⏸ when paused, its filter under it) — and a grid of number
  buttons; a number opens that subscription's menu: ❌ remove, 🔎 filter (not on a watched single
  listing), ▶️ resume when paused, ↩ back.
- **Keyword filter** per subscription (🔎): the user replies to the bot's prompt with words
  separated by commas; only listings whose title, description or address hold every word of at
  least one phrase are delivered (any order, case and ё ignored, a word's start matches its
  endings — «лобов стекл»). «-» clears it. What does not match is recorded as seen silently and
  never comes back; listings already seen before the filter was set do not come back either.
  Health signals (partial fetch, overflow, mass change) still count the whole page. A removal is
  matched by title only. Only a reply to the prompt sets a filter — a stray message never does.
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
- Baseline on subscribe; seen marked **only after successful delivery** — a message Telegram
  refuses is skipped and comes back next run, while the rest of the batch still goes out. Two
  exceptions end a delivery early: a blocked chat (the scheduled run then pauses the user), and
  three refusals in a row, read as Telegram being down — the remainder waits for the next run.
- Failures are loud: a fetch **or parse** failure (outage, bot-wall, layout change) raises an
  error — never mistaken for an empty search. Redirects are pinned to the source's host.
- Storage: **Postgres (TypeORM, generated migrations)** — users, subscriptions and the seen set
  survive restarts; seen is pruned to a bounded window per subscription; per-user limit on
  **active** subscriptions (auto-paused ones don't count) + duplicate-URL guard (a link's sort,
  paging and tracking params don't make a new search — each source's own list).
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

1. The scheduler runs the scrape on its cron (daily to start), read in Minsk time: `WATCH_CRON`
   `0 9 * * *` is 09:00 Europe/Minsk, whatever the server's clock.
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
- **A site we do not support** — the link is refused and filed as a GitHub issue «Source request:
  <site>» (label `source-request`) for the owner to have the parser added: one issue per site,
  later links as comments (up to 5 samples), at most 10 new issues a day. The issue carries the
  link (minus any login), never who sent it; a site whose issue the owner closed is not filed again — the repo is public. The user is told the request was passed on only
  when it was (`GITHUB_ISSUES_TOKEN` set and GitHub answered) — and then remembered in our database
  (who, which link; never in the issue), and told once by the daily run when a source reads that
  link («✅ Теперь умею…», resend to subscribe); the request is then deleted — or after 180 days
  unanswered. Decision — PRODUCT_PLAN.md Фаза 6.
- **A link we cannot watch as sent** (a bid.cars filter we cannot apply, a kufar-travel
  hotel) is refused on subscribe; one kept from before is paused by the next run at once, with the
  same reason — not five «failures» and a false «Проверьте ссылку».
- **Dead-man's switch:** the app pings an external watchdog every 5 minutes (`HEARTBEAT_URL`);
  when the pings stop, the watchdog alerts the owner (setup — DEPLOY.md §4.3b).
- **Admin alerts:** the owner (`ADMIN_TELEGRAM_ID`, required in production — otherwise every alert
  would go nowhere silently) is told about each auto-pause (403 / dead link / a link we cannot
  watch), and about a source's **health changing**: once when every poll of it fails, a reminder a week later if it is still
  failing, and a line when it answers again, with how long it was silent. Repeating the same alert
  every run is how an alert channel stops being read; the recovery line is how the owner learns a
  fix worked. Recovery needs a successful poll, not merely the absence of a failure verdict — that
  verdict needs at least three polls, so a source with fewer subscriptions is neither reported nor
  given the reprieve above (PRODUCT_PLAN.md § Технический бэклог). The state lives in the
  process, so a restart re-announces an ongoing outage as new.
- **Source with no subscribers:** stop scraping it and purge its data.

## Architecture

**Source** — the only place that knows about a specific site: a parser plus a declarative
definition (host, pinned sort/page size, paging, `parse`). Shared code turns it into an adapter
that recognizes the link and fetches normalized listings
([architecture.md § Adding a Source](llm/rules/architecture.md#adding-a-source)).

`SourceRegistry` picks the adapter via `matches()` (or by id). The core (fetch →
diff → notify), the bot, and the DB schema know nothing about specific sites.
`fetch` returns `Listing`s with a stable `externalId` — the diff/dedup key.

URL dedupe shipped as `normalizeUrl` in `common/url.ts`,
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

A new source = its parser and definition; the core, the bot, and the DB schema stay unchanged.
An unsupported link → GitHub Issue → the source is added (including with LLM help).
