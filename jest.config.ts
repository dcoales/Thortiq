import type {Config} from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/packages', '<rootDir>/apps', '<rootDir>/services'],
  testPathIgnorePatterns: [
    '/dist/',
    '<rootDir>/services/sync-server/src/__tests__' // Skip sync server suite; hangs without dedicated env
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleNameMapper: {
    '^@thortiq/client-core$': '<rootDir>/packages/client-core/src'
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.jest.json'
    }
  }
};

export default config;
