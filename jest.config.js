module.exports = {
  preset: 'jest-expo',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Worktrees under .claude/ are copies of this repo: jest must not run their tests.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/\\.claude/'],
};
