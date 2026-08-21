// class-transformer needs the polyfill; other suites get it transitively via Nest.
import 'reflect-metadata';

import { AppEnv, validateEnv } from '../env.validation';

describe('validateEnv', () => {
  it('applies the schema defaults on an empty env', () => {
    const env = validateEnv({});

    expect(env.PORT).toBe(3000);
    expect(env.WATCH_CRON).toBe('0 9 * * *');
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => validateEnv({ PORT: '0' })).toThrow('PORT');
  });

  it('rejects a WATCH_CRON that is not 5 fields', () => {
    expect(() => validateEnv({ WATCH_CRON: '0 9 * *' })).toThrow('WATCH_CRON');
  });

  it('requires TELEGRAM_BOT_TOKEN in production — the bot is the product', () => {
    expect(() => validateEnv({ APP_ENV: AppEnv.Production })).toThrow('TELEGRAM_BOT_TOKEN');
    // Production also requires SCRAPE_PROXY_URL and ADMIN_TELEGRAM_ID (see below) — supplied
    // so this asserts the token.
    const prod = {
      APP_ENV: AppEnv.Production,
      SCRAPE_PROXY_URL: 'http://p:8888',
      ADMIN_TELEGRAM_ID: 1,
      HEARTBEAT_URL: 'https://hc.example/ping/abc',
    };
    expect(validateEnv({ ...prod, TELEGRAM_BOT_TOKEN: 't' }).TELEGRAM_BOT_TOKEN).toBe('t');
  });

  describe('ADMIN_TELEGRAM_ID', () => {
    it('is required in production — without it every owner alert goes nowhere, silently', () => {
      expect(() =>
        validateEnv({
          APP_ENV: AppEnv.Production,
          TELEGRAM_BOT_TOKEN: 't',
          SCRAPE_PROXY_URL: 'http://p:8888',
        }),
      ).toThrow('ADMIN_TELEGRAM_ID');
    });

    it('stays optional outside production', () => {
      expect(validateEnv({ APP_ENV: AppEnv.Development }).ADMIN_TELEGRAM_ID).toBeUndefined();
    });

    it('rejects a non-numeric value outside production — it would become a silent NaN', () => {
      expect(() =>
        validateEnv({ APP_ENV: AppEnv.Development, ADMIN_TELEGRAM_ID: '@name' }),
      ).toThrow('ADMIN_TELEGRAM_ID');
    });
  });

  describe('HEARTBEAT_URL', () => {
    it('is required in production — without it nothing reports the app dying', () => {
      expect(() =>
        validateEnv({
          APP_ENV: AppEnv.Production,
          TELEGRAM_BOT_TOKEN: 't',
          SCRAPE_PROXY_URL: 'http://p:8888',
          ADMIN_TELEGRAM_ID: 1,
        }),
      ).toThrow('HEARTBEAT_URL');
    });

    it('rejects a value that is not an http(s) URL', () => {
      expect(() => validateEnv({ HEARTBEAT_URL: 'hc.example/ping' })).toThrow('HEARTBEAT_URL');
    });
  });

  describe('SCRAPE_PROXY_URL', () => {
    it('is required in production', () => {
      expect(() => validateEnv({ APP_ENV: AppEnv.Production, TELEGRAM_BOT_TOKEN: 't' })).toThrow(
        'SCRAPE_PROXY_URL',
      );
    });

    it('stays optional outside production', () => {
      expect(validateEnv({ APP_ENV: AppEnv.Staging }).SCRAPE_PROXY_URL).toBeUndefined();
    });

    it('is still format-checked outside production when set', () => {
      expect(() => validateEnv({ APP_ENV: AppEnv.Staging, SCRAPE_PROXY_URL: 'not-a-url' })).toThrow(
        'SCRAPE_PROXY_URL',
      );
    });
  });
});
