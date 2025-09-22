import type {Config} from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages', '<rootDir>/apps', '<rootDir>/services'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleNameMapper: {
    '^@thortiq/client-core$': '<rootDir>/packages/client-core/src'
  }
};

export default config;
