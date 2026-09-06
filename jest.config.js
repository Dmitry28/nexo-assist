/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coveragePathIgnorePatterns: ['\\.module\\.ts$', 'main\\.ts$', '\\.dto\\.ts$'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // Global stubs: no unit spec may hit the network or send a Sentry event (see each file).
  setupFilesAfterEnv: [
    '<rootDir>/__tests__/setup/mock-undici-fetch.ts',
    '<rootDir>/__tests__/setup/mock-sentry.ts',
  ],
  clearMocks: true,
  maxWorkers: '50%',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
