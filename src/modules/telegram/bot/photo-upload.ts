import { InputFile } from 'grammy';
import { type Response, fetch } from 'undici';

import { matchesHost } from '@/common/url';

const PHOTO_TIMEOUT_MS = 10_000;
// Telegram's own cap on an uploaded photo.
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
// Telegram refuses an upload without a file name, and reads the type from its extension
// (measured by the prototype on idriver's WebP).
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * A photo Telegram could not fetch by URL, downloaded so it can go up as a file instead — some
 * CDNs refuse Telegram's fetcher but serve us (idriver: «failed to get HTTP URL content»).
 *
 * Only from the source's own site (its host or a subdomain — idriver.by → img77.idriver.by): the
 * URL is scraped, and the server must not fetch an address a page put there. For the same reason a
 * redirect is followed once and only on that site — kufar balances rms.kufar.by → rms2.kufar.by
 * (302, measured 2026-10-25). Anything else throws, saying why, and the caller sends the card as text.
 * NOTE: the status is checked, not just the type: idriver answers a missing photo with its «фото
 * по запросу» placeholder as a 404 image/jpeg (measured 2026-10-19).
 * NOTE: without a Content-Length the body is buffered whole before the size check (bounded by
 * the timeout) — the same trade as fetchHtml in sources/scraping/http.ts.
 */
export async function downloadPhoto(url: string, site: string): Promise<InputFile> {
  let res = await fetchOnSite(url, site);
  const location = isRedirect(res.status) ? res.headers.get('location') : null;
  if (location !== null) {
    await res.body?.cancel();
    res = await fetchOnSite(new URL(location, url).href, site);
  }
  const type = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
  // Own keys only: a header like `constructor` must not find Object.prototype's.
  const extension = Object.hasOwn(EXTENSIONS, type) ? EXTENSIONS[type] : undefined;
  if (!res.ok || extension === undefined) {
    // An unread body holds the connection open.
    await res.body?.cancel();
    throw new Error(`photo HTTP ${res.status} ${type || 'no type'}: ${url}`);
  }
  if (Number(res.headers.get('content-length') ?? 0) > MAX_PHOTO_BYTES) {
    await res.body?.cancel();
    throw new Error(`photo over ${MAX_PHOTO_BYTES} bytes: ${url}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
    throw new Error(`photo of ${bytes.length} bytes: ${url}`);
  }
  return new InputFile(bytes, `photo.${extension}`);
}

async function fetchOnSite(url: string, site: string): Promise<Response> {
  if (!url.startsWith('https://') || !matchesHost({ url, host: site })) {
    throw new Error(`photo off ${site}: ${url}`);
  }
  // A second redirect stays a 3xx here and fails the status check below.
  return fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
}

const isRedirect = (status: number): boolean => status >= 300 && status < 400;
