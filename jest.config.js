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
  // Stubs undici's fetch so no unit spec can reach the network (see the file's NOTE).
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup/mock-undici-fetch.ts'],
  clearMocks: true,
  maxWorkers: '50%',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
