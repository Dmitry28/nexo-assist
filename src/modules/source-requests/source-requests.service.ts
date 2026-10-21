import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as Sentry from '@sentry/nestjs';
import { LessThan } from 'typeorm';
import type { Repository } from 'typeorm';
import { fetch } from 'undici';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import { SourceRegistry } from '@/modules/sources/source-registry';

import { SourceRequest } from './entities/source-request.entity';

// Where a link to a site we do not support becomes a task: the owner runs an LLM on the issue to
// add the parser. The repo is public — an issue carries the link only, never who sent it.
const REPO = 'Dmitry28/nexo-assist';
export const LABEL = 'source-request';
// Sample links per site: enough to see its search shapes; past it, more users only repeat them.
export const MAX_SAMPLES = 5;
// Per day — anyone can message the bot: new issues (each unknown host would open one), and links
// handled at all (each costs GitHub calls, run one at a time while users wait for the reply).
export const MAX_NEW_PER_DAY = 10;
const MAX_LINKS_PER_DAY = 50;
// Short: the user's reply waits on it, and the bot handles one update at a time — a hanging
// GitHub would stall every chat, not just this one.
const TIMEOUT_MS = 5_000;
// A request not answered by then is let go: the site was declined, or its parser does not read
// that link — keeping who asked any longer serves no notice (/help: data only to notify).
const REQUEST_KEPT_DAYS = 180;

interface Issue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  comments: number;
}

/** A site's name for its request: `www.` is the same site. Throws on a malformed URL. */
export const requestHost = (url: string): string => new URL(url).hostname.replace(/^www\./, '');

export const requestTitle = (host: string): string => `Source request: ${host}`;

/**
 * The link as published: without a login or a fragment, and as code — the repo is public, and a
 * bare `@name` in it would ping that GitHub user.
 */
export const publicLink = (url: string): string => {
  const link = new URL(url);
  link.username = '';
  link.password = '';
  link.hash = '';
  return `\`${link.href.replaceAll('`', '%60')}\``;
};

const requestBody = (link: string): string =>
  'A user sent a link to a site the bot does not support yet.\n\n' +
  `Sample: ${link}\n\n` +
  'To add it, follow `docs/llm/rules/architecture.md` § Adding a Source: one folder in ' +
  '`src/modules/sources/` mirroring an existing source (the prototype `~/dp/my/land-scraper` may ' +
  'already have this site), one line in `sources.ts`. Measure the site from the production server, ' +
  'not only from home — a site can answer one and refuse the other (§ Adding a Source says how). ' +
  'More samples, if users send them, come as comments.';

/**
 * Files a link to an unsupported site as a GitHub issue — one per site, later links as comments.
 * A site whose issue the owner closed is not filed again: closed means declined (an added site
 * no longer reaches here).
 *
 * Token unset → disabled (local, tests). Read from the environment rather than AppConfig, like
 * HEARTBEAT_URL: it is a credential, and the bootstrap logs the whole config object.
 *
 * NOTE: the `source-request` label is created in the repo once, by hand (DEPLOY.md) — GitHub may
 * drop a label that does not exist, and an issue without it is never found again (one per link).
 *
 * NOTE: the caps and the seen-link set are in memory, reset daily and on restart. The issue itself
 * is found again by its title, so a reset costs at most a repeated sample, never a duplicate issue.
 */
@Injectable()
export class SourceRequestsService {
  private readonly logger = new Logger(SourceRequestsService.name);
  private filed = new Set<string>();
  // One request at a time: two users sending the same new site at once would open two issues.
  private queue: Promise<unknown> = Promise.resolve();
  private day = '';
  private linksToday = 0;
  private createdToday = 0;

  constructor(
    @Inject(configuration.KEY) private readonly appConfig: AppConfig,
    @InjectRepository(SourceRequest) private readonly requests: Repository<SourceRequest>,
    private readonly registry: SourceRegistry,
  ) {}

  /**
   * Request support for `url`'s site on behalf of `telegramId`. Resolves to whether the request
   * is on file (now or from before, the same link from another user included) — and only then is
   * the user remembered, to be told when the site is added (`supported`). Not filed (the day's cap,
   * a declined site, GitHub down) — not promised, not remembered. Never rejects: GitHub or the
   * database failing must not fail the reply.
   */
  async request(url: string, telegramId: number): Promise<boolean> {
    const token = process.env.GITHUB_ISSUES_TOKEN;
    // A link `new URL` refuses has no site to request — extractUrl takes any `http…` run.
    if (this.appConfig.isTest || !token || !URL.canParse(url)) return false;
    const next = this.queue.then(() => this.file(url, token)).catch(() => false);
    this.queue = next;
    if (!(await next)) return false;
    try {
      // createdAt set explicitly: an upsert leaves unset columns alone, and `expire` counts the
      // 180 days from the user's latest ask, not their first.
      await this.requests.upsert(
        { telegramId, host: requestHost(url), url, createdAt: new Date() },
        ['telegramId', 'host'],
      );
    } catch (err) {
      // Filed all the same: the site still gets added, only this user is not told when.
      this.logger.warn({ err }, 'Source request filed, but the requester not remembered');
      Sentry.captureException(err);
    }
    return true;
  }

  /**
   * The remembered requests whose link a source now reads — a parser for the site shipped.
   * TODO [L]: loads every row; fine while requests are few (each is deleted once told).
   */
  async supported(): Promise<SourceRequest[]> {
    const all = await this.requests.find();
    return all.filter((request) => this.registry.match(request.url) !== null);
  }

  /** Forget requests older than REQUEST_KEPT_DAYS; resolves to how many. */
  async expire(): Promise<number> {
    const before = new Date(Date.now() - REQUEST_KEPT_DAYS * 24 * 60 * 60 * 1000);
    const { affected } = await this.requests.delete({ createdAt: LessThan(before) });
    return affected ?? 0;
  }

  /** The requester was told (or cannot be): nothing left to keep about them. */
  async forget(id: string): Promise<void> {
    await this.requests.delete({ id });
  }

  private async file(url: string, token: string): Promise<boolean> {
    this.rollDay();
    if (this.filed.has(url)) return true;
    if (this.linksToday >= MAX_LINKS_PER_DAY) {
      this.logger.warn(`Source request not handled — ${MAX_LINKS_PER_DAY} links today`);
      return false;
    }
    this.linksToday++;
    try {
      const host = requestHost(url);
      const link = publicLink(url);
      const issue = await this.findRequest(host, token);
      if (issue?.state === 'closed') return false;
      if (issue) {
        // The issue body holds the first sample. `comments` counts the owner's too — fewer samples
        // once he has replied, which is fine.
        if (issue.comments < MAX_SAMPLES - 1) {
          await this.call(token, `issues/${issue.number}/comments`, { body: `Sample: ${link}` });
        }
      } else {
        if (this.createdToday >= MAX_NEW_PER_DAY) {
          this.logger.warn(`Source request for ${host} not filed — ${MAX_NEW_PER_DAY} new today`);
          return false;
        }
        await this.call(token, 'issues', {
          title: requestTitle(host),
          body: requestBody(link),
          labels: [LABEL],
        });
        this.createdToday++;
        this.logger.log(`Source request filed: ${host}`);
      }
      this.filed.add(url);
      return true;
    } catch (err) {
      this.logger.warn({ err }, 'Source request failed');
      Sentry.captureException(err);
      return false;
    }
  }

  // NOTE: the newest 100 requests only — past that the backlog itself is the problem.
  private async findRequest(host: string, token: string): Promise<Issue | undefined> {
    const issues = (await this.call(
      token,
      `issues?labels=${LABEL}&state=all&per_page=100`,
    )) as Issue[];
    return issues.find((issue) => issue.title === requestTitle(host));
  }

  private rollDay(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today === this.day) return;
    this.day = today;
    this.filed = new Set();
    this.linksToday = 0;
    this.createdToday = 0;
  }

  /** One GitHub REST call — a GET without `body`. Throws on a non-2xx answer. */
  private async call(token: string, path: string, body?: object): Promise<unknown> {
    const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'nexo-assist',
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
    return res.json();
  }
}
