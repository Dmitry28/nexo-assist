import 'reflect-metadata';

/**
 * Load the module fresh for a given stage — the DataSource is built once at import time, so the
 * value of APP_ENV when it is first imported is the whole behaviour under test.
 */
const optionsFor = async (appEnv: string | undefined): Promise<{ ssl?: unknown }> => {
  const previous = process.env.APP_ENV;
  if (appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = appEnv;
  let options: { ssl?: unknown } = {};
  try {
    await jest.isolateModulesAsync(async () => {
      const module = await import('../data-source');
      options = module.default.options as { ssl?: unknown };
    });
  } finally {
    if (previous === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previous;
  }
  return options;
};

// The initContainer runs migrations through this DataSource before the app starts, so it is a
// second, earlier path to the same database — and the one that would carry the password in the
// clear if it disagreed with app.module.ts about TLS.
describe('the migration DataSource', () => {
  it.each(['production', 'staging'])('verifies the certificate on %s', async (appEnv) => {
    expect((await optionsFor(appEnv)).ssl).toEqual({ rejectUnauthorized: true });
  });

  it.each([undefined, 'development', 'test'])(
    'leaves TLS off locally (APP_ENV=%s) — the docker database speaks plaintext',
    async (appEnv) => {
      expect((await optionsFor(appEnv)).ssl).toBe(false);
    },
  );
});
