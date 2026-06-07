import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { parseFile } from '../../src/parser';
import { uploadRun, toCtrf, toTestRelicRun } from '../../src/uploader';

const root = join(__dirname, '..', '..');

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

test.describe('uploader', () => {
  test('missing API key skips gracefully with remediation hint', async () => {
    const run = parseFile(join(root, 'fixtures', 'ctrf-valid.json'));
    const result = await uploadRun(run, { endpoint: 'https://platform.testrelic.ai/api/v1' });
    expect(result.uploaded).toBe(false);
    expect(result.reason).toMatch(/TESTRELIC_API_KEY not set/i);
    expect(result.reason).toMatch(/\.env/i);
  });

  test('HTTP 500 on auth is caught and reported, not thrown; key redacted', async () => {
    const run = parseFile(join(root, 'fixtures', 'ctrf-valid.json'));
    const mockFetch: typeof fetch = async () =>
      ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'upstream error',
      }) as Response;

    const result = await uploadRun(
      run,
      { apiKey: 'tr_test_key_12345678', endpoint: 'https://platform.testrelic.ai/api/v1' },
      { fetchImpl: mockFetch }
    );
    expect(result.uploaded).toBe(false);
    expect(result.reason).toMatch(/HTTP 500/);
    expect(result.reason).not.toContain('tr_test_key_12345678');
  });

  test('401 on auth is caught and reported, not thrown', async () => {
    const run = parseFile(join(root, 'fixtures', 'ctrf-valid.json'));
    const mockFetch: typeof fetch = async () =>
      jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });

    const result = await uploadRun(
      run,
      { apiKey: 'tr_bad_key_abcdefgh', endpoint: 'https://platform.testrelic.ai/api/v1' },
      { fetchImpl: mockFetch }
    );
    expect(result.uploaded).toBe(false);
    expect(result.reason).toMatch(/HTTP 401/);
    expect(result.reason).not.toContain('tr_bad_key_abcdefgh');
  });

  test('successful two-step upload returns a dashboard URL', async () => {
    const run = parseFile(join(root, 'fixtures', 'ctrf-valid.json'));
    const calls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/sdk/auth/token')) {
        return jsonResponse(200, { accessToken: 'at_123', orgName: 'Acme', userName: 'dev' });
      }
      return jsonResponse(200, { runId: 'run_xyz' });
    };

    const result = await uploadRun(
      run,
      { apiKey: 'tr_live_key_12345678', endpoint: 'https://platform.testrelic.ai/api/v1' },
      { fetchImpl: mockFetch }
    );
    expect(result.uploaded).toBe(true);
    expect(result.dashboardUrl).toMatch(/dashboards\/test-runs\/run_xyz/);
    expect(calls[0]).toMatch(/\/sdk\/auth\/token$/);
    expect(calls[1]).toMatch(/\/runs$/);
  });

  test('toTestRelicRun builds native run payload', () => {
    const run = parseFile(join(root, 'fixtures', 'ctrf-valid.json'));
    const payload = toTestRelicRun(run, 'run_test_1', 'testrelic-signal-demo') as Record<string, unknown>;
    expect(payload.runId).toBe('run_test_1');
    expect(payload.repoGitId).toBe('testrelic-signal-demo');
    const summary = payload.summary as Record<string, number>;
    expect(summary.failed).toBe(run.totals.failed);
    expect(Array.isArray(payload.timeline)).toBe(true);
  });

  test('toCtrf builds CTRF-shaped payload', () => {
    const run = parseFile(join(root, 'fixtures', 'ctrf-valid.json'));
    const ctrf = toCtrf(run, 'testrelic-signal-demo');
    expect(ctrf.reportFormat).toBe('CTRF');
    const results = ctrf.results as Record<string, unknown>;
    const summary = results.summary as Record<string, number>;
    expect(summary.failed).toBe(run.totals.failed);
  });
});
