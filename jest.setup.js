// Jest setup file
// Add any global test setup here

// AsyncStorage has no native module under Jest; use the package's mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
