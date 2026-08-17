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
    // Production also requires SCRAPE_PROXY_URL (see below) — supplied so this asserts the token.
    const prod = { APP_ENV: AppEnv.Production, SCRAPE_PROXY_URL: 'http://p:8888' };
    expect(validateEnv({ ...prod, TELEGRAM_BOT_TOKEN: 't' }).TELEGRAM_BOT_TOKEN).toBe('t');
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
