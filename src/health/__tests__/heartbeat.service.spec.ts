import { Logger } from '@nestjs/common';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { undiciFetchMock } from '@/__tests__/helpers/undici';
import { AppEnv } from '@/config/env.validation';

import { HeartbeatService, PING_INTERVAL_MS } from '../heartbeat.service';

const PING_URL = 'https://hc.example/ping/abc';

describe('HeartbeatService', () => {
  let service: HeartbeatService;

  const start = (env = AppEnv.Development, url?: string) => {
    if (url === undefined) delete process.env.HEARTBEAT_URL;
    else process.env.HEARTBEAT_URL = url;
    service = new HeartbeatService(makeAppConfig({ appEnv: env }));
    service.onModuleInit();
  };

  beforeEach(() => {
    undiciFetchMock().mockResolvedValue({ ok: true, status: 200 });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    service.onModuleDestroy();
    delete process.env.HEARTBEAT_URL;
    jest.restoreAllMocks();
  });

  it('pings at once, so a wrong URL surfaces during the deploy', () => {
    start(AppEnv.Development, PING_URL);

    expect(undiciFetchMock()).toHaveBeenCalledWith(PING_URL, expect.anything());
  });

  it('stays silent when no watchdog is configured', () => {
    start(AppEnv.Development, undefined);

    expect(undiciFetchMock()).not.toHaveBeenCalled();
  });

  it('never pings under tests — .env is loaded there too', () => {
    start(AppEnv.Test, PING_URL);

    expect(undiciFetchMock()).not.toHaveBeenCalled();
  });

  it('keeps pinging on the interval — a single ping would prove nothing', () => {
    jest.useFakeTimers();
    start(AppEnv.Development, PING_URL);

    jest.advanceTimersByTime(2 * PING_INTERVAL_MS);

    expect(undiciFetchMock()).toHaveBeenCalledTimes(3); // immediate + two intervals
    jest.useRealTimers();
  });

  it('warns on a rejected ping — a mistyped URL answers 404, it does not throw', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    undiciFetchMock().mockResolvedValue({ ok: false, status: 404 });

    start(AppEnv.Development, PING_URL);
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('404'));
  });

  it('survives a failing ping — the watchdog alerting is the point, not our retry', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    undiciFetchMock().mockRejectedValue(new Error('network down'));

    start(AppEnv.Development, PING_URL);
    await Promise.resolve(); // let the fire-and-forget ping settle

    expect(warn).toHaveBeenCalledWith(expect.anything(), 'Heartbeat failed');
  });
});
