const path = require('path');

// This checkout's own .claude/ (the worktrees under it) holds copies of this repo: jest must not run their tests.
const claudeDir = path
  .join(__dirname, '.claude')
  .split(path.sep)
  .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('[\\\\/]');

module.exports = {
  preset: 'jest-expo',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', `^${claudeDir}[\\\\/]`],
};
