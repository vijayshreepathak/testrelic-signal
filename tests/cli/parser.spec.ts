import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { parseFile } from '../../src/parser';
import { SignalError } from '../../src/types';

const root = join(__dirname, '..', '..');

test.describe('parser', () => {
  test('parses valid CTRF into correct totals and normalized model', () => {
    const run = parseFile(join(root, 'fixtures', 'ctrf-valid.json'));
    expect(run.tool).toContain('playwright');
    expect(run.totals.passed).toBe(4);
    expect(run.totals.failed).toBe(3);
    expect(run.totals.flaky).toBe(1);
    expect(run.tests.length).toBe(8);
    const checkout = run.tests.find((t) => t.name.includes('sales tax'));
    expect(checkout?.status).toBe('failed');
    expect(checkout?.errorMessage).toMatch(/Expected.*108/);
  });

  test('handles missing and null fields without crashing', () => {
    const run = parseFile(join(root, 'fixtures', 'ctrf-missing-fields.json'));
    expect(run.tests.length).toBe(4);
    const unnamed = run.tests.find((t) => t.name === 'unnamed test');
    expect(unnamed?.status).toBe('passed');
    const checkout = run.tests.find((t) => t.name.includes('checkout'));
    expect(checkout?.retries).toBe(0);
    expect(checkout?.errorMessage).toBeUndefined();
    expect(run.totals.failed).toBeGreaterThanOrEqual(1);
  });

  test('throws a helpful error for malformed JSON', () => {
    expect(() => parseFile(join(root, 'fixtures', 'ctrf-malformed.json'))).toThrow(SignalError);
    try {
      parseFile(join(root, 'fixtures', 'ctrf-malformed.json'));
    } catch (err) {
      expect(err).toBeInstanceOf(SignalError);
      expect((err as SignalError).message).toMatch(/not valid JSON/i);
      expect((err as SignalError).remediation).toMatch(/CTRF|Playwright/i);
    }
  });
});
