import { defineConfig, devices } from '@playwright/test';
import { loadDotenv } from './src/config';

// Playwright does not auto-load .env — do it here so the TestRelic reporter and
// cloud upload pick up TESTRELIC_API_KEY from the project-root .env file.
loadDotenv();

const demoBase = 'http://127.0.0.1:4173';

/** CLI module tests need no browser, demo server, or TestRelic reporter. */
const isCliOnlyRun =
  process.argv.includes('--project=cli') &&
  !process.argv.some((arg) => arg.includes('e2e'));

/** TestRelic reporter streams/uploads — enable only when a real API key is set. */
const useTestRelicReporter = Boolean(process.env.TESTRELIC_API_KEY?.trim());

const testRelicReporter = [
  '@testrelic/playwright-analytics',
  {
    outputPath: './test-results/analytics-timeline.json',
    openReport: false,
    includeStackTrace: true,
    includeCodeSnippets: true,
    includeNetworkStats: true,
    includeArtifacts: true,
    cloud: {
      apiKey: process.env.TESTRELIC_API_KEY,
      endpoint: 'https://platform.testrelic.ai/api/v1',
      upload: 'both' as const,
      uploadArtifacts: true,
    },
  },
] as const;

/**
 * Playwright config for testrelic-signal.
 *
 * Upload path #1 (test runs): the official @testrelic/playwright-analytics reporter
 * uploads each Playwright run to TestRelic when TESTRELIC_API_KEY is set.
 * Options mirror docs.testrelic.ai/getting-started/installation exactly.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: isCliOnlyRun
    ? [['list']]
    : [
        ['list'],
        ...(useTestRelicReporter ? [testRelicReporter] : []),
        ['json', { outputFile: 'test-results/playwright-report.json' }],
      ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'cli',
      testMatch: /cli\/.*\.spec\.ts/,
    },
    {
      name: 'e2e',
      testMatch: /e2e\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // Local: use installed Google Chrome (no `playwright install chromium`).
        // CI: bundled Chromium from `playwright install chromium` in ci.yml.
        ...(process.env.CI ? {} : { channel: 'chrome' as const }),
        baseURL: demoBase,
      },
    },
  ],
  webServer: isCliOnlyRun
    ? undefined
    : {
        command: 'node scripts/serve-demo.js',
        url: demoBase,
        reuseExistingServer: !process.env.CI,
      },
});
