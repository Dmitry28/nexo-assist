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
    expect(
      validateEnv({ APP_ENV: AppEnv.Production, TELEGRAM_BOT_TOKEN: 't' }).TELEGRAM_BOT_TOKEN,
    ).toBe('t');
  });
});
