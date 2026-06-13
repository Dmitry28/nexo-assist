import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { KufarService } from './kufar.service';

const fixture = readFileSync(join(__dirname, '__tests__/fixtures/kufar-search.html'), 'utf8');

describe('KufarService', () => {
  let service: KufarService;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    service = new KufarService();
    fetchMock = jest.spyOn(global, 'fetch');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches and parses listings from a search url', async () => {
    fetchMock.mockResolvedValue(new Response(fixture, { status: 200 }));

    const listings = await service.fetch('https://re.kufar.by/l/minsk/kupit/garazh');

    expect(listings).toHaveLength(2);
    expect(listings[0].adId).toBe(1069720654);
  });

  it('returns [] on a non-OK response', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));

    expect(await service.fetch('https://re.kufar.by/l/x')).toEqual([]);
  });

  it('returns [] when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    expect(await service.fetch('https://re.kufar.by/l/x')).toEqual([]);
  });
});
