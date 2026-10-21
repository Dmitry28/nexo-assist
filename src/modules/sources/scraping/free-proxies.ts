import { BlockList, isIPv4 } from 'node:net';

import { Logger } from '@nestjs/common';
import { fetch } from 'undici';

import { SourceUnavailableError } from '../source-adapter';

import { fetchHtml, fetchJson } from './http';
import type { Protection } from './ladder';
import { asArray, asRecord } from './next-data';
import type { Post } from './providers';

// Two public lists of free proxies per country, re-checked by their maintainers every few minutes.
// Two because each is thin and they disagree: the proxy idriver went through on 2026-10-13 was on
// one only an hour later. What they unlock — PRODUCT_PLAN.md § «Шаг 4а».
const LISTS: readonly { url: (country: string) => string; read: (body: string) => string }[] = [
  {
    url: (country) =>
      `https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/${country.toUpperCase()}/data.txt`,
    read: (body) => body,
  },
  {
    url: (country) =>
      `https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&country=${country.toUpperCase()}`,
    // JSON; each HTTP proxy's ip and port, written the way the first list writes them.
    read: (body) => {
      type Entry = { ip?: unknown; port?: unknown; protocols?: unknown };
      const data = asArray<unknown>(asRecord(JSON.parse(body))?.data) ?? [];
      return data
        .filter((entry): entry is Entry => typeof entry === 'object' && entry !== null)
        .filter(
          ({ protocols }) =>
            Array.isArray(protocols) && protocols.some((p) => p === 'http' || p === 'https'),
        )
        .map(({ ip, port }) => `http://${String(ip)}:${String(port)}`)
        .join('\n');
    },
  },
];
const LIST_TIMEOUT_MS = 5_000;
const MAX_LIST_LENGTH = 1024 * 1024;
const LIST_FRESH_FOR_MS = 60 * 60 * 1000;
// A list with nothing left for a site — the fetch failed, or every entry failed that site this
// hour — is asked again sooner: the next poll may otherwise pay for what a fresh list would have
// served free.
const EMPTY_LIST_FRESH_FOR_MS = 5 * 60 * 1000;
// How many proxies are tried at once, and for how long in all: the paid rungs after this one need
// the rest of the ladder's budget.
const RACE_SIZE = 3;
const RUNG_CAP_MS = 20_000;

// Addresses a list entry must never point the pod at: loopback, private, link-local (the cloud
// metadata service), CGNAT, documentation, benchmark, multicast, reserved.
const NOT_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  NOT_PUBLIC.addSubnet(net, prefix, 'ipv4');
}

/**
 * The usable entries of a list: HTTP proxies on a public IPv4 literal — no host names (no DNS to
 * rebind), no SOCKS (undici's agent speaks HTTP CONNECT). The lists mark one that tunnels https
 * as `https`; it is spoken to over plain HTTP all the same (the tunnel carries the TLS).
 */
export function parseProxyList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => /^https?:\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(line.trim()))
    .filter((match) => match !== null)
    .filter(
      ([, ip, port]) => isIPv4(ip) && !NOT_PUBLIC.check(ip, 'ipv4') && +port > 0 && +port < 65536,
    )
    .map(([, ip, port]) => `${ip}:${port}`);
}

/**
 * A country's list, with the proxies that failed each site. Per site, because a proxy one site
 * blocks may serve another: measured, the two proxies that read idriver and av.by never got
 * through bid.cars. A refetched list starts clean.
 */
interface CountryList {
  at: number;
  proxies: string[];
  failed: Map<string, Set<string>>;
}

const logger = new Logger('scraping:free-proxies');
const lists = new Map<string, CountryList>();
const loading = new Map<string, Promise<CountryList>>();
/** The proxy that last returned a site's real page, per host. */
const lastGood = new Map<string, string>();

/** For specs: forget the cached lists and the proxies that worked. */
export const resetFreeProxies = (): void => {
  lists.clear();
  loading.clear();
  lastGood.clear();
};

/** The list's proxies that have not failed this site. */
const healthy = (list: CountryList, host: string): string[] =>
  list.proxies.filter((proxy) => !list.failed.get(host)?.has(proxy));

/**
 * The country's list — the cached one while fresh for this site, one fetch at a time otherwise.
 * NOTE: a refetch for one site clears what the others learned too — at worst one wasted race each.
 */
function listFor(country: string, host: string): Promise<CountryList> {
  const cached = lists.get(country);
  const freshFor =
    cached && healthy(cached, host).length > 0 ? LIST_FRESH_FOR_MS : EMPTY_LIST_FRESH_FOR_MS;
  if (cached && Date.now() - cached.at < freshFor) return Promise.resolve(cached);
  const pending = loading.get(country) ?? load(country).finally(() => loading.delete(country));
  loading.set(country, pending);
  return pending;
}

async function load(country: string): Promise<CountryList> {
  const texts = await Promise.all(LISTS.map((list) => fetchList(list, country)));
  const list = {
    at: Date.now(),
    proxies: [...new Set(texts.flatMap(parseProxyList))],
    failed: new Map(),
  };
  lists.set(country, list);
  return list;
}

/** One list's entries as text lines — empty when it fails, whatever the way. */
async function fetchList(list: (typeof LISTS)[number], country: string): Promise<string> {
  try {
    const res = await fetch(list.url(country), {
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      redirect: 'error',
    });
    // A declared oversize is refused unread; an undeclared one is bounded by the timeout.
    if (!res.ok || Number(res.headers.get('content-length')) > MAX_LIST_LENGTH) return '';
    return list.read((await res.text()).slice(0, MAX_LIST_LENGTH));
  } catch {
    return '';
  }
}

/**
 * The free rung: a few public proxies of the site's country (or its `freeProxyCountry`), raced — the first to
 * return the real page wins and is tried first for that site next time. Proxies that failed a site
 * are not tried for it again this hour (a list with none left is fetched again — see
 * EMPTY_LIST_FRESH_FOR_MS). Only through the https tunnel (`proxyUrl` of fetchHtml, or fetchJson
 * for a POST), so all a stranger's proxy can do is fail.
 */
export function freeProxyRung(
  url: string,
  host: string,
  usable: Protection['usable'],
  country: string,
  post?: Post,
): { name: string; run: (timeoutMs: number) => Promise<string> } {
  return {
    name: 'free-proxy',
    run: async (timeoutMs) => {
      const list = await listFor(country, host);
      const sticky = lastGood.get(host);
      const picks = [
        ...(sticky === undefined ? [] : [sticky]),
        ...healthy(list, host).filter((proxy) => proxy !== sticky),
      ].slice(0, RACE_SIZE);
      if (picks.length === 0) {
        throw new SourceUnavailableError(
          list.proxies.length === 0
            ? `no free ${country} proxy listed`
            : `every free ${country} proxy failed ${host} this hour`,
        );
      }
      const race = new AbortController();
      const attempt = async (proxy: string): Promise<{ proxy: string; html: string }> => {
        const through = {
          url,
          host,
          proxyUrl: `http://${proxy}`,
          timeoutMs: Math.min(timeoutMs, RUNG_CAP_MS),
          signal: race.signal,
        };
        // NOTE: the tunnel keeps TLS, yet a stranger's proxy is no place for a secret — a `post`
        // here is a site's public search (Copart's), never one carrying credentials.
        const html = await (post ? fetchJson({ ...through, ...post }) : fetchHtml(through));
        if (!usable(html)) throw new SourceUnavailableError('not the page');
        return { proxy, html };
      };
      try {
        const { proxy, html } = await Promise.any(picks.map(attempt));
        lastGood.set(host, proxy);
        logger.log(`${host} via free ${country} proxy ${proxy}`);
        return html;
      } catch {
        // Whatever went wrong through a stranger's proxy — a refused tunnel, a block page, even a
        // redirect off the host — says something about that IP, not about the URL: the proxy
        // failed this site, and the ladder goes on. Recorded on the list the picks came from: a
        // refetch meanwhile starts clean.
        const failed = list.failed.get(host) ?? new Set<string>();
        for (const proxy of picks) failed.add(proxy);
        list.failed.set(host, failed);
        // Unless a concurrent poll of the site has found a new one meanwhile.
        if (sticky !== undefined && lastGood.get(host) === sticky) lastGood.delete(host);
        throw new SourceUnavailableError(`${picks.length} free ${country} proxies failed`);
      } finally {
        // The losers' requests: nobody waits for them.
        race.abort();
      }
    },
  };
}
