import configuration from '../configuration';

// Security-relevant mapping (feeds app.enableCors): '*' allows all, an empty value must
// block all cross-origin (empty allowlist), and a list is split/trimmed. validateEnv owns
// the schema; this covers the factory's CORS_ORIGIN → corsOrigins transform.
describe('configuration — corsOrigins mapping', () => {
  const original = process.env.CORS_ORIGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = original;
  });

  const corsOrigins = (value: string): '*' | string[] => {
    process.env.CORS_ORIGIN = value;
    return configuration().corsOrigins;
  };

  it("maps '*' to allow-all", () => {
    expect(corsOrigins('*')).toBe('*');
  });

  it('maps an empty value to an empty allowlist (blocks all cross-origin)', () => {
    expect(corsOrigins('')).toEqual([]);
  });

  it('splits and trims a comma-separated list, dropping blanks', () => {
    expect(corsOrigins('https://a.com, https://b.com ,')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
});
