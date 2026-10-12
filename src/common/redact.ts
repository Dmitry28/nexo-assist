// Query params that carry a credential: the paid anti-bot services take their key in the URL
// (ZenRows `apikey`, Scrape.do `token` — sources/scraping/providers.ts).
const SECRET_PARAM = /\b(apikey|api_key|token)=[^&\s"'#]+/gi;

/** `text` with every credential-carrying query value replaced — for anything leaving the process. */
export const redactSecrets = (text: string): string => text.replace(SECRET_PARAM, '$1=[redacted]');

/**
 * A breadcrumb with credentials stripped from its message and string data — Sentry's fetch
 * integration records every outgoing request's URL and query, and ships them with the next event.
 */
export function redactBreadcrumb<T extends { message?: string; data?: Record<string, unknown> }>(
  crumb: T,
): T {
  const data =
    crumb.data &&
    Object.fromEntries(
      Object.entries(crumb.data).map(([key, value]) => [
        key,
        typeof value === 'string' ? redactSecrets(value) : value,
      ]),
    );
  return {
    ...crumb,
    ...(crumb.message === undefined ? {} : { message: redactSecrets(crumb.message) }),
    ...(data === undefined ? {} : { data }),
  };
}
