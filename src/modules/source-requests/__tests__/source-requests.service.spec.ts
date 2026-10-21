import { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { sentryCapture } from '@/__tests__/helpers/sentry';
import { sourceAdapter } from '@/__tests__/helpers/sources';
import { undiciFetchMock } from '@/__tests__/helpers/undici';
import { AppEnv } from '@/config/env.validation';
import { SourceRegistry } from '@/modules/sources/source-registry';

import type { SourceRequest } from '../entities/source-request.entity';
import {
  LABEL,
  MAX_NEW_PER_DAY,
  MAX_SAMPLES,
  SourceRequestsService,
  publicLink,
  requestHost,
  requestTitle,
} from '../source-requests.service';

const answer = (body: unknown, status = 200) => ({
  ok: status < 300,
  status,
  json: () => Promise.resolve(body),
});

type Issue = { number: number; title: string; state: 'open' | 'closed'; comments: number };

/** GitHub as a fake: `issues` is what the label listing returns; every POST answers 201. */
const github = (issues: Issue[] = []) =>
  undiciFetchMock().mockImplementation((_url: string, init: { method: string }) =>
    Promise.resolve(init.method === 'GET' ? answer(issues) : answer({}, 201)),
  );

const posts = () =>
  undiciFetchMock()
    .mock.calls.filter(([, init]) => (init as { method: string }).method === 'POST')
    .map(([url, init]) => ({
      url: url as string,
      body: JSON.parse((init as { body: string }).body) as Record<string, unknown>,
    }));

describe('SourceRequestsService', () => {
  const repo = {
    upsert: jest.fn().mockResolvedValue(undefined),
    find: jest.fn(),
    delete: jest.fn(),
  };
  const build = (config = makeAppConfig()) =>
    new SourceRequestsService(
      config,
      repo as unknown as Repository<SourceRequest>,
      new SourceRegistry([sourceAdapter('kufar')]),
    );

  beforeEach(() => {
    process.env.GITHUB_ISSUES_TOKEN = 'token';
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => delete process.env.GITHUB_ISSUES_TOKEN);

  it('names a site without www', () => {
    expect(requestHost('https://www.Example.com/a?b=1')).toBe('example.com');
  });

  it('publishes a link without its login or fragment, as code (no @-mention pings)', () => {
    expect(publicLink('https://u:p@site.by/s?q=@bob#x')).toBe('`https://site.by/s?q=@bob`');
  });

  it('opens one labelled issue per new site, with the link and no user', async () => {
    github();
    await expect(build().request('https://www.example.com/s?q=1', 7)).resolves.toBe(true);
    const [post] = posts();
    expect(post.url).toMatch(/\/issues$/);
    expect(post.body).toMatchObject({ title: requestTitle('example.com'), labels: [LABEL] });
    expect(post.body.body).toContain('`https://www.example.com/s?q=1`');
  });

  it('adds a later link to the open issue as a comment, up to the sample cap', async () => {
    const title = requestTitle('example.com');
    github([{ number: 7, title, state: 'open', comments: 0 }]);
    await build().request('https://example.com/b', 7);
    expect(posts()).toEqual([
      { url: expect.stringMatching(/\/issues\/7\/comments$/), body: { body: expect.any(String) } },
    ]);

    undiciFetchMock().mockClear();
    github([{ number: 7, title, state: 'open', comments: MAX_SAMPLES - 1 }]);
    await expect(build().request('https://example.com/c', 7)).resolves.toBe(true);
    expect(posts()).toHaveLength(0);
  });

  it('does not file a site again once its request was closed (declined)', async () => {
    github([{ number: 3, title: requestTitle('example.com'), state: 'closed', comments: 0 }]);
    await expect(build().request('https://example.com/a', 7)).resolves.toBe(false);
    expect(posts()).toHaveLength(0);
  });

  it('answers false for a malformed link and keeps serving the next one', async () => {
    github();
    const service = build();
    await expect(service.request('http://[x', 7)).resolves.toBe(false);
    // Refused up front: no bug report for the user's typo.
    expect(sentryCapture()).not.toHaveBeenCalled();
    await expect(service.request('https://example.com/a', 7)).resolves.toBe(true);
  });

  it('files the same link once a day', async () => {
    github();
    const service = build();
    await service.request('https://example.com/a', 7);
    await service.request('https://example.com/a', 7);
    expect(posts()).toHaveLength(1);
  });

  it(`opens at most ${MAX_NEW_PER_DAY} new issues a day`, async () => {
    github();
    const service = build();
    for (let i = 0; i <= MAX_NEW_PER_DAY; i++) await service.request(`https://site${i}.com/`, 7);
    expect(posts()).toHaveLength(MAX_NEW_PER_DAY);
    await expect(service.request('https://late.com/', 7)).resolves.toBe(false);
  });

  it('answers false, never throws, when GitHub fails', async () => {
    undiciFetchMock().mockResolvedValue(answer({}, 500));
    await expect(build().request('https://example.com/', 7)).resolves.toBe(false);
  });

  it('is off without a token and under tests', async () => {
    delete process.env.GITHUB_ISSUES_TOKEN;
    await expect(build().request('https://example.com/', 7)).resolves.toBe(false);
    process.env.GITHUB_ISSUES_TOKEN = 'token';
    const underTest = build(makeAppConfig({ appEnv: AppEnv.Test }));
    await expect(underTest.request('https://example.com/', 7)).resolves.toBe(false);
    expect(undiciFetchMock()).not.toHaveBeenCalled();
  });

  it('remembers who asked, per site, only once the request is filed', async () => {
    github();
    await build().request('https://www.example.com/s', 7);
    expect(repo.upsert).toHaveBeenCalledWith(
      {
        telegramId: 7,
        host: 'example.com',
        url: 'https://www.example.com/s',
        createdAt: expect.any(Date),
      },
      ['telegramId', 'host'],
    );

    repo.upsert.mockClear();
    undiciFetchMock().mockResolvedValue(answer({}, 500));
    await build().request('https://other.com/', 7);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('still answers filed when remembering the requester fails', async () => {
    github();
    repo.upsert.mockRejectedValueOnce(new Error('db down'));
    await expect(build().request('https://example.com/', 7)).resolves.toBe(true);
  });

  it('finds the requests a source now reads', async () => {
    repo.find.mockResolvedValue([
      { id: 'a', url: 'https://re.kufar.by/l/minsk' },
      { id: 'b', url: 'https://example.com/s' },
    ]);
    await expect(build().supported()).resolves.toEqual([
      { id: 'a', url: 'https://re.kufar.by/l/minsk' },
    ]);
  });
});

describe('SourceRequestsService.expire', () => {
  it('drops requests older than the cap', async () => {
    const repo = { delete: jest.fn().mockResolvedValue({ affected: 2 }) };
    const service = new SourceRequestsService(
      makeAppConfig(),
      repo as unknown as Repository<SourceRequest>,
      new SourceRegistry([]),
    );
    await expect(service.expire()).resolves.toBe(2);
    expect(repo.delete).toHaveBeenCalledWith({ createdAt: expect.anything() });
  });
});
