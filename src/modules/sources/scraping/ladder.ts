import { Logger } from '@nestjs/common';

import {
  PaidRungsUnavailableError,
  SearchRewrittenError,
  SourceUnavailableError,
} from '../source-adapter';

import { freeProxyRung } from './free-proxies';
import { fetchHtml, fetchJson, hasProxy } from './http';
import { ProviderUnavailableError, paidRungs } from './providers';
import type { Post } from './providers';

/**
 * How a source behind anti-bot protection is read (see fetchProtected). Declared by the source.
 */
export interface Protection {
  /**
   * The page we asked for rather than a challenge or a block — judged by the page's frame, never
   * by its listings: an empty search is a real page, and calling it unusable would pay every rung
   * on every poll of it.
   */
  usable: (html: string) => boolean;
  /** Lower-case ISO-2 country the paid rung's proxy must be in (idriver: Belarus only). */
  country?: string;
  /**
   * Free proxies of this country first, for a site with no country of its own — so its paid pool
   * stays the global one (Copart: US proxies, 2 of 200 got through Imperva, 2026-10-20 — the owner
   * keeps every free way first).
   */
  freeProxyCountry?: string;
  /**
   * Render the page in a browser and wait this long (ms) — only for a page behind a script gate.
   * Billed on top of the anti-bot tier by the geo providers (25 credits a page instead of 10).
   */
  renderWaitMs?: number;
}

const logger = new Logger('scraping:ladder');

// One page's whole ladder, every rung included. The free rungs take at most 30 + 30 s. A site with
// a country adds 25 s of free proxies (with their list fetch), and ZenRows and Scrape.do keep their
// minute each; ScrapeOps (2 min of its own retries) only gets a turn when the rungs before it
// failed fast — no key, spent — and ScrapFly, the last, likewise. A site without one has only
// ScrapingAnt and ScraperAPI, a minute each (providers.ts) — after free proxies of its
// `freeProxyCountry` when it names one (Copart: up to 20 s a page of its walk). WatchStatus's
// stuck-run arithmetic counts this per protected poll.
const LADDER_BUDGET_MS = 240_000;

/**
 * Fetch a protected page up a ladder: a plain request, our proxy, free proxies of the site's
 * country, then the paid anti-bot services that have a key — the first rung that returns the real
 * page wins. Free rungs first: they cost nothing, and a site may let one through. One time budget
 * for all of them, so a page cannot hold the polling slot for minutes per rung.
 *
 * Only a source's own unavailability climbs — an HTTP error, a timeout, a challenge page. A
 * redirect off the host or a rewritten search is a verdict on the URL, and thrown as is (so is a
 * redirect loop: a challenge that redirects forever does not climb). When no paid service could
 * even be asked, the error says so (PaidRungsUnavailableError).
 * NOTE: the paid rungs fetch on the provider's side, so the per-hop host pin of the free rungs does
 * not apply there; the URL itself was matched to the source before it got here.
 */
export async function fetchProtected({
  url,
  host,
  useProxy = false,
  protection,
  post,
}: {
  url: string;
  host: string;
  useProxy?: boolean;
  protection: Protection;
  /** A POST instead of a GET (Copart's search) — every free rung carries it, and the paid rungs
   *  that were measured forwarding one. */
  post?: Post;
}): Promise<string> {
  const deadline = Date.now() + LADDER_BUDGET_MS;
  const freeCountry = protection.country ?? protection.freeProxyCountry;
  const free = (name: string, viaProxy: boolean) => ({
    name,
    paid: false,
    run: (ms: number) =>
      post
        ? fetchJson({ url, host, useProxy: viaProxy, timeoutMs: ms, ...post })
        : fetchHtml({ url, host, useProxy: viaProxy, timeoutMs: ms }),
  });
  const rungs = [
    // A source that must go through the proxy has no direct rung.
    ...(useProxy ? [] : [free('plain', false)]),
    ...(hasProxy() ? [free('proxy', true)] : []),
    // A stranger's proxy of the site's country — or of `freeProxyCountry` — may get through free.
    ...(freeCountry === undefined
      ? []
      : [{ ...freeProxyRung(url, host, protection.usable, freeCountry, post), paid: false }]),
    ...paidRungs(url, protection, post).map((rung) => ({ ...rung, paid: true })),
  ];
  const reasons: string[] = [];
  // Whether a paid service was actually asked — if none was, the failure is ours to fix.
  let paidAsked = false;
  for (const rung of rungs) {
    const left = deadline - Date.now();
    if (left <= 0) {
      reasons.push(`${rung.name}: out of time`);
      break;
    }
    try {
      const html = await rung.run(left);
      paidAsked ||= rung.paid;
      if (protection.usable(html)) {
        // Every page names its rung: which way a site answers today is the first thing to know
        // when it stops (a paid rung adds its cost and what is left — providers.ts).
        logger.log(`${host} via ${rung.name}`);
        return html;
      }
      reasons.push(`${rung.name}: not the page (a challenge?)`);
    } catch (err) {
      if (!(err instanceof SourceUnavailableError) || err instanceof SearchRewrittenError) {
        throw err;
      }
      paidAsked ||= rung.paid && !(err instanceof ProviderUnavailableError);
      reasons.push(`${rung.name}: ${err.message}`);
    }
  }
  const summary = `no rung got ${url} — ${reasons.join('; ')}`;
  // NOTE: running out of time before the paid rungs lands here too — rare: the free rungs take
  // 30 s each at most.
  throw paidAsked ? new SourceUnavailableError(summary) : new PaidRungsUnavailableError(summary);
}
