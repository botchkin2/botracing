// https://docs.expo.dev/guides/using-eslint/
const {defineConfig} = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/',
      'build/',
      'scripts/',
      'node_modules/',
      '**/*.min.js',
      '**/*.min.css',
      '.expo/',
      '.expo-shared/',
      'ios/Pods/',
      '.DS_Store',
      'Thumbs.db',
      'ehthumbs.db',
      'Desktop.ini',
      '.vscode/',
      '.idea/',
      '**/*.log',
      'logs/',
      '**/*.map',
      '.metro-health-check*',
      'coverage/',
      '.yarn/',
      'jest.config.js',
      'jest.setup.js',
      'package-lock.json',
    ],
    plugins: {
      'react-native': require('eslint-plugin-react-native'),
    },
    settings: {
      'import/resolver': {
        typescript: {project: './tsconfig.json'},
      },
    },
    rules: {
      'jsx-quotes': 'off', // Disable since Prettier handles quote consistency
      'react-native/no-inline-styles': 'warn', // Keep as warning, not error
      'react-hooks/exhaustive-deps': 'off', // Allow flexible dependency management
    },
  },
  {
    files: ['*.ts', '*.tsx'],
    rules: {
      '@typescript-eslint/no-shadow': ['error'],
      'no-shadow': 'off',
      'no-undef': 'off',
    },
  },
  // Layering for the new app (docs/ARCHITECTURE.md). Old folders are not
  // listed; they are deleted as the new screens replace them.
  {
    files: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    // Tests may import the test runner and fixtures.
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            // analysis is pure: the uploader runs it in Node, so no imports at all.
            {target: './src/analysis', from: './', except: ['./src/analysis']},
            {
              target: './src/design',
              from: './src',
              except: ['./design', './analysis'],
            },
            {
              target: './src/ui',
              from: './src',
              except: ['./ui', './design', './analysis'],
            },
            {
              target: './src/charts',
              from: './src',
              except: ['./charts', './ui', './design', './analysis'],
            },
            {
              target: './src/data',
              from: './src',
              except: ['./data', './analysis'],
            },
            {
              target: './src/state',
              from: './src',
              except: ['./state', './analysis'],
            },
            {target: './src/nav', from: './', except: ['./src/nav']},
            // Connected navigation: may read data, design and ui, never a feature or state.
            {
              target: './src/workspace',
              from: './src',
              except: [
                './workspace',
                './nav',
                './data',
                './design',
                './ui',
                './analysis',
              ],
            },
            // A feature never imports another feature; share through ui, charts, data or analysis.
            {
              target: './src/features/sessions',
              from: './src/features',
              except: ['./sessions'],
            },
            {
              target: './src/features/session',
              from: './src/features',
              except: ['./session'],
            },
            {
              target: './src/features/compare',
              from: './src/features',
              except: ['./compare'],
            },
            {
              target: './src/features/corner',
              from: './src/features',
              except: ['./corner'],
            },
            {
              target: './src/features/settings',
              from: './src/features',
              except: ['./settings'],
            },
          ],
        },
      ],
    },
  },
]);
