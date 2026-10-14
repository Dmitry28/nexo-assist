/**
 * The paid anti-bot services' endpoints (sources/scraping/providers.ts). Most take the API key in
 * the query string (ScrapingAnt in a header), so whatever records outgoing URLs must skip or scrub
 * them — OTel spans (tracing.ts) skip these origins; Sentry breadcrumbs (common/redact.ts) scrub
 * the key params. Dependency-free on purpose: tracing.ts loads it before anything else is
 * required.
 */
export const PAID_SCRAPER_ORIGIN =
  /^https:\/\/(api\.zenrows\.com|api\.scrape\.do|proxy\.scrapeops\.io|api\.scraperapi\.com|api\.scrapingant\.com|api\.scrapfly\.io)(\/|$)/;
