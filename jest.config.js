// The pod's clock, on every machine: a spec must not pass only because the laptop happens to
// sit in Minsk. Set here, before anything caches it.
process.env.TZ = 'UTC';

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  // `__tests__/`: jest excludes the spec files themselves, but not the helpers and fixtures
  // beside them — they were reported at 100% and flattered the overall figure.
  coveragePathIgnorePatterns: ['__tests__/', '\\.module\\.ts$', 'main\\.ts$', '\\.dto\\.ts$'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // Global stubs: no unit spec may hit the network or send a Sentry event (see each file).
  setupFilesAfterEnv: [
    '<rootDir>/__tests__/setup/mock-undici-fetch.ts',
    '<rootDir>/__tests__/setup/mock-sentry.ts',
  ],
  clearMocks: true,
  // One process, everywhere: jest's worker pool segfaults roughly once in seven runs, and the
  // killed worker's suite simply does not run while the summary still reads "N passed". The
  // suite takes ~5 s in band, so the pool buys nothing (cause unknown — PRODUCT_PLAN.md backlog).
  maxWorkers: 1,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
